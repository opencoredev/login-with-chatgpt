import { describe, expect, test } from "bun:test";
import { ensureFreshTokens, isAccessTokenExpired, resolveConfig } from "../src/index.ts";
import { createMockFetch, jsonResponse, makeAccessToken, makeIdToken } from "./helpers.ts";

describe("token freshness", () => {
  test("detects expired / soon-to-expire access tokens", () => {
    expect(isAccessTokenExpired({ accessToken: makeAccessToken(-10) })).toBe(true);
    expect(isAccessTokenExpired({ accessToken: makeAccessToken(30) })).toBe(true); // inside margin
    expect(isAccessTokenExpired({ accessToken: makeAccessToken(3600) })).toBe(false);
    expect(isAccessTokenExpired({ accessToken: "" })).toBe(true);
  });

  test("returns current tokens when still fresh", async () => {
    const fetch = createMockFetch(() => {
      throw new Error("should not refresh");
    });
    const config = resolveConfig({ fetch });
    const tokens = { accessToken: makeAccessToken(3600), refreshToken: "rt", accountId: "acct_1" };
    const result = await ensureFreshTokens(config, tokens);
    expect(result.accessToken).toBe(tokens.accessToken);
    expect(fetch.calls.length).toBe(0);
  });

  test("refreshes and reports new tokens via onRefresh when expired", async () => {
    const fetch = createMockFetch(() =>
      jsonResponse({ access_token: makeAccessToken(3600), refresh_token: "rt2", id_token: makeIdToken({ accountId: "acct_2" }) }),
    );
    const config = resolveConfig({ fetch });
    let saved: unknown;
    const result = await ensureFreshTokens(
      config,
      { accessToken: makeAccessToken(-10), refreshToken: "rt1" },
      { onRefresh: (t) => void (saved = t) },
    );
    expect(result.accountId).toBe("acct_2");
    expect(result.refreshToken).toBe("rt2");
    expect(saved).toEqual(result);
  });

  test("throws not_authenticated with no usable credentials", async () => {
    const config = resolveConfig();
    await expect(ensureFreshTokens(config, undefined)).rejects.toMatchObject({
      code: "not_authenticated",
    });
  });
});
