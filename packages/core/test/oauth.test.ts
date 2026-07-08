import { describe, expect, test } from "bun:test";
import {
  ChatGPTAuthError,
  createAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshTokens,
  resolveConfig,
} from "../src/index.ts";
import { createMockFetch, jsonResponse, makeIdToken } from "./helpers.ts";

describe("oauth", () => {
  test("builds the authorization URL with PKCE and codex params", () => {
    const config = resolveConfig();
    const url = new URL(
      createAuthorizationUrl(config, {
        redirectUri: "http://localhost:1455/auth/callback",
        pkce: { verifier: "v", challenge: "chal" },
        state: "st",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://auth.openai.com/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge")).toBe("chal");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("id_token_add_organizations")).toBe("true");
    expect(url.searchParams.get("originator")).toBe("codex_cli_rs");
  });

  test("exchanges an authorization code for tokens", async () => {
    const idToken = makeIdToken({ accountId: "acct_9" });
    const fetch = createMockFetch(() =>
      jsonResponse({ access_token: "at", refresh_token: "rt", id_token: idToken, expires_in: 3600 }),
    );
    const config = resolveConfig({ fetch });
    const tokens = await exchangeAuthorizationCode(config, {
      code: "code",
      codeVerifier: "verifier",
      redirectUri: "https://auth.openai.com/deviceauth/callback",
    });
    expect(tokens.accessToken).toBe("at");
    expect(tokens.refreshToken).toBe("rt");
    expect(tokens.accountId).toBe("acct_9");
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());

    const body = String(fetch.calls[0]?.init?.body);
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code_verifier=verifier");
  });

  test("refreshes tokens and keeps the old refresh token when none is returned", async () => {
    const fetch = createMockFetch(() => jsonResponse({ access_token: "at2", id_token: makeIdToken() }));
    const config = resolveConfig({ fetch });
    const tokens = await refreshTokens(config, "old-refresh");
    expect(tokens.accessToken).toBe("at2");
    expect(tokens.refreshToken).toBe("old-refresh");
  });

  test("maps a dead refresh token to refresh_token_invalid", async () => {
    const fetch = createMockFetch(() => jsonResponse({ error: "refresh_token_expired" }, 400));
    const config = resolveConfig({ fetch });
    await expect(refreshTokens(config, "dead")).rejects.toMatchObject({
      code: "refresh_token_invalid",
    } satisfies Partial<ChatGPTAuthError>);
  });

  test("maps other refresh failures to token_refresh_failed", async () => {
    const fetch = createMockFetch(() => jsonResponse({ error: "server_error" }, 500));
    const config = resolveConfig({ fetch });
    await expect(refreshTokens(config, "x")).rejects.toMatchObject({ code: "token_refresh_failed" });
  });
});
