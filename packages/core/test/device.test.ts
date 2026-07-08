import { describe, expect, test } from "bun:test";
import {
  pollDeviceCode,
  requestDeviceCode,
  resolveConfig,
  waitForDeviceTokens,
} from "../src/index.ts";
import { createMockFetch, jsonResponse, makeIdToken } from "./helpers.ts";

describe("device flow", () => {
  test("requests a device code and normalizes the interval", async () => {
    const fetch = createMockFetch((url) => {
      expect(url).toBe("https://auth.openai.com/api/accounts/deviceauth/usercode");
      return jsonResponse({ device_auth_id: "dev_1", user_code: "ABCD-1234", interval: "5" });
    });
    const config = resolveConfig({ fetch });
    const device = await requestDeviceCode(config, () => 1_000);
    expect(device.deviceAuthId).toBe("dev_1");
    expect(device.userCode).toBe("ABCD-1234");
    expect(device.interval).toBe(5);
    expect(device.verificationUrl).toBe("https://auth.openai.com/codex/device");
    expect(device.expiresAt).toBe(1_000 + 15 * 60 * 1000);
  });

  test("surfaces disabled device login as a typed error", async () => {
    const fetch = createMockFetch(() => new Response("", { status: 404 }));
    const config = resolveConfig({ fetch });
    await expect(requestDeviceCode(config)).rejects.toMatchObject({ code: "device_code_disabled" });
  });

  test("treats 403/404/429 polls as pending and 200 as authorized", async () => {
    const statuses = [403, 404, 429];
    let call = 0;
    const fetch = createMockFetch(() => {
      const status = statuses[call++];
      if (status !== undefined) return new Response("", { status });
      return jsonResponse({ authorization_code: "ac_1", code_challenge: "chal", code_verifier: "ver" });
    });
    const config = resolveConfig({ fetch });
    const device = { deviceAuthId: "dev_1", userCode: "ABCD-1234" };

    // 403, 404, and 429 (Cloudflare challenge) are all "keep waiting".
    expect(await pollDeviceCode(config, device)).toEqual({ status: "pending" });
    expect(await pollDeviceCode(config, device)).toEqual({ status: "pending" });
    expect(await pollDeviceCode(config, device)).toEqual({ status: "pending" });
    expect(await pollDeviceCode(config, device)).toEqual({
      status: "authorized",
      authorizationCode: "ac_1",
      codeChallenge: "chal",
      codeVerifier: "ver",
    });
  });

  test("waitForDeviceTokens polls until authorized then exchanges", async () => {
    let pollCount = 0;
    const fetch = createMockFetch((url) => {
      if (url.endsWith("/deviceauth/token")) {
        pollCount += 1;
        if (pollCount < 3) return new Response("", { status: 403 });
        return jsonResponse({ authorization_code: "ac", code_challenge: "c", code_verifier: "v" });
      }
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({ access_token: "at", refresh_token: "rt", id_token: makeIdToken() });
      }
      throw new Error(`unexpected ${url}`);
    });
    const config = resolveConfig({ fetch });
    const device = {
      deviceAuthId: "dev",
      userCode: "code",
      verificationUrl: "https://auth.openai.com/codex/device",
      interval: 1,
      expiresAt: Number.MAX_SAFE_INTEGER,
    };

    const tokens = await waitForDeviceTokens(config, device, {
      now: () => 0,
      sleep: async () => {}, // no real waiting in tests
    });
    expect(pollCount).toBe(3);
    expect(tokens.accessToken).toBe("at");
    expect(tokens.accountId).toBe("acct_123");
  });

  test("waitForDeviceTokens throws when the code expires", async () => {
    const fetch = createMockFetch(() => new Response("", { status: 403 }));
    const config = resolveConfig({ fetch });
    await expect(
      waitForDeviceTokens(
        config,
        {
          deviceAuthId: "d",
          userCode: "c",
          verificationUrl: "u",
          interval: 1,
          expiresAt: 10,
        },
        { now: () => 100, sleep: async () => {} },
      ),
    ).rejects.toMatchObject({ code: "authorization_expired" });
  });
});
