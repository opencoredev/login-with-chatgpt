import type { ResolvedConfig } from "./config.ts";
import { ChatGPTAuthError } from "./errors.ts";
import { deriveAccountId, getTokenExpiry } from "./jwt.ts";
import type { ChatGPTTokens, PkcePair } from "./types.ts";

interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}

/** Normalizes OpenAI's token payload into {@link ChatGPTTokens}. */
function toTokens(raw: RawTokenResponse, previousRefreshToken?: string): ChatGPTTokens {
  if (!raw.access_token) {
    throw new ChatGPTAuthError("token_exchange_failed", "Token response missing access_token.");
  }
  const idToken = raw.id_token;
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? previousRefreshToken,
    idToken,
    accountId: deriveAccountId(idToken) ?? deriveAccountId(raw.access_token),
    expiresAt:
      typeof raw.expires_in === "number"
        ? Date.now() + raw.expires_in * 1000
        : getTokenExpiry(raw.access_token),
  };
}

/**
 * Builds the authorization URL for the loopback (redirect) PKCE flow. Prefer
 * the device-code flow for cloud/serverless — this one needs a loopback
 * listener and only works when the user is on the same machine.
 */
export function createAuthorizationUrl(
  config: ResolvedConfig,
  params: { redirectUri: string; pkce: PkcePair; state: string },
): string {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("code_challenge", params.pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", config.originator);
  return url.toString();
}

/** Exchanges an authorization code (+ PKCE verifier) for tokens. */
export async function exchangeAuthorizationCode(
  config: ResolvedConfig,
  params: { code: string; codeVerifier: string; redirectUri: string },
): Promise<ChatGPTTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    code: params.code,
    code_verifier: params.codeVerifier,
    redirect_uri: params.redirectUri,
  });

  let response: Response;
  try {
    response = await config.fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
    });
  } catch (cause) {
    throw new ChatGPTAuthError("network_error", "Failed to reach the token endpoint.", { cause });
  }

  if (!response.ok) {
    const text = await safeText(response);
    throw new ChatGPTAuthError("token_exchange_failed", `Authorization code exchange failed (${response.status}).`, {
      status: response.status,
      body: text,
    });
  }

  return toTokens((await response.json()) as RawTokenResponse);
}

/** Error codes OpenAI returns when a refresh token can no longer be used. */
const DEAD_REFRESH_ERRORS = new Set([
  "refresh_token_expired",
  "refresh_token_reused",
  "refresh_token_invalidated",
  "invalid_grant",
]);

/** Exchanges a refresh token for a fresh access token (and possibly a new refresh token). */
export async function refreshTokens(
  config: ResolvedConfig,
  refreshToken: string,
): Promise<ChatGPTTokens> {
  let response: Response;
  try {
    response = await config.fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: config.clientId,
        scope: config.scope,
      }),
    });
  } catch (cause) {
    throw new ChatGPTAuthError("network_error", "Failed to reach the token endpoint.", { cause });
  }

  if (!response.ok) {
    const text = await safeText(response);
    const errorCode = extractErrorCode(text);
    if (errorCode && DEAD_REFRESH_ERRORS.has(errorCode)) {
      throw new ChatGPTAuthError("refresh_token_invalid", `Refresh token is no longer valid (${errorCode}). The user must sign in again.`, {
        status: response.status,
        body: text,
      });
    }
    throw new ChatGPTAuthError("token_refresh_failed", `Token refresh failed (${response.status}).`, {
      status: response.status,
      body: text,
    });
  }

  return toTokens((await response.json()) as RawTokenResponse, refreshToken);
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function extractErrorCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.error === "string") return parsed.error;
  } catch {
    // not JSON — ignore
  }
  return undefined;
}
