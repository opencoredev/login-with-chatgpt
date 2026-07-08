import { describe, expect, test } from "bun:test";
import { MemoryStore, resolveConfig } from "@loginwithchatgpt/core";
import { SessionManager, type StoredSession } from "../src/session.ts";
import { createOpenAIMock } from "./helpers.ts";

function makeManager(now: () => number, fetch: ReturnType<typeof createOpenAIMock>) {
  return new SessionManager({
    config: resolveConfig({ fetch }),
    store: new MemoryStore<StoredSession>({ now }),
    sessionTtlMs: 60_000,
    secret: "s",
    now,
  });
}

describe("SessionManager", () => {
  test("starts a device login and reuses the code while valid", async () => {
    let clock = 1000;
    const fetch = createOpenAIMock();
    const manager = makeManager(() => clock, fetch);

    const first = await manager.startDeviceLogin("sid");
    expect(first.device.userCode).toBe("ABCD-1234");

    const second = await manager.startDeviceLogin("sid");
    expect(second.device.userCode).toBe("ABCD-1234");
    // Only one usercode request should have been made.
    expect(fetch.calls.filter((c) => c.url.endsWith("/deviceauth/usercode")).length).toBe(1);
  });

  test("advances a pending login to authenticated", async () => {
    let clock = 1000;
    const fetch = createOpenAIMock({ pollsUntilAuthorized: 1 });
    const manager = makeManager(() => clock, fetch);

    await manager.startDeviceLogin("sid");

    clock += 2000; // let the poll interval elapse
    const data = await manager.advance("sid");
    expect(data.status).toBe("authenticated");
    expect(data.user?.email).toBe("savio@result.dev");
    expect(data.tokens?.accessToken).toBeString();
  });

  test("rate-limits polling to the device interval", async () => {
    let clock = 1000;
    const fetch = createOpenAIMock({ pollsUntilAuthorized: 5 });
    const manager = makeManager(() => clock, fetch);
    await manager.startDeviceLogin("sid");

    await manager.advance("sid"); // first poll allowed (lastPolledAt was 0)
    await manager.advance("sid"); // immediate second call — should be skipped
    const pollCount = fetch.calls.filter((c) => c.url.endsWith("/deviceauth/token")).length;
    expect(pollCount).toBe(1);
  });

  test("returns fresh tokens for authenticated sessions", async () => {
    let clock = 1000;
    const fetch = createOpenAIMock({ pollsUntilAuthorized: 1 });
    const manager = makeManager(() => clock, fetch);
    await manager.startDeviceLogin("sid");
    clock += 2000;
    await manager.advance("sid");

    const tokens = await manager.getFreshTokens("sid");
    expect(tokens?.accountId).toBe("acct_1");
  });

  test("expires pending sessions on a short TTL but keeps authenticated ones", async () => {
    let clock = 1000;
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const store = new MemoryStore<StoredSession>({ now: () => clock });
    const fetch = createOpenAIMock({ pollsUntilAuthorized: 1 });
    const manager = new SessionManager({
      config: resolveConfig({ fetch }),
      store,
      sessionTtlMs: THIRTY_DAYS,
      secret: "s",
      now: () => clock,
    });

    // One session that stays pending, one that authenticates.
    await manager.startDeviceLogin("pending-1");
    await manager.startDeviceLogin("auth-1");
    clock += 2000;
    expect((await manager.advance("auth-1")).status).toBe("authenticated");

    // 31 minutes on: the unauthenticated junk entry is gone even though the
    // session TTL is 30 days; the authenticated session still lives.
    clock += 31 * 60 * 1000;
    expect(await manager.load("pending-1")).toBeUndefined();
    expect((await manager.load("auth-1"))?.status).toBe("authenticated");
  });
});
