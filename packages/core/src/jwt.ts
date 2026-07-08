import { AUTH_CLAIM } from "./constants.ts";
import { base64UrlDecodeToString } from "./internal/base64.ts";
import type { ChatGPTUser } from "./types.ts";

/**
 * Decodes a JWT payload without verifying its signature.
 *
 * These tokens come straight from OpenAI's token endpoint over TLS, so we only
 * read claims we already trust. Never use this to validate a token from an
 * untrusted source.
 */
export function decodeJwt(token: string | undefined): Record<string, unknown> | undefined {
  if (typeof token !== "string") return undefined;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return undefined;
  try {
    const parsed = JSON.parse(base64UrlDecodeToString(parts[1]));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Extracts the `exp` claim as epoch milliseconds, or `undefined`. */
export function getTokenExpiry(token: string | undefined): number | undefined {
  const claims = decodeJwt(token);
  const exp = claims?.["exp"];
  return typeof exp === "number" ? exp * 1000 : undefined;
}

/** Reads the ChatGPT account id from an id (or access) token. */
export function deriveAccountId(token: string | undefined): string | undefined {
  const auth = decodeJwt(token)?.[AUTH_CLAIM];
  if (isRecord(auth) && typeof auth["chatgpt_account_id"] === "string") {
    return auth["chatgpt_account_id"];
  }
  return undefined;
}

/** Builds a public {@link ChatGPTUser} profile from an id token. */
export function parseUser(idToken: string | undefined): ChatGPTUser | undefined {
  const claims = decodeJwt(idToken);
  if (!claims) return undefined;
  const accountId = deriveAccountId(idToken);
  if (!accountId) return undefined;

  const auth = isRecord(claims[AUTH_CLAIM]) ? (claims[AUTH_CLAIM] as Record<string, unknown>) : {};
  return {
    accountId,
    email: asString(claims["email"]),
    name: asString(claims["name"]),
    plan: asString(auth["chatgpt_plan_type"]),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
