/** A `fetch`-compatible function. Defaults to the runtime global. */
export type FetchLike = typeof fetch;

/**
 * OAuth tokens for a signed-in ChatGPT user.
 *
 * `accessToken` is short-lived; `refreshToken` mints new access tokens. Both are
 * secrets — keep them server-side. `accountId` is derived from the id token and
 * is required on every model request.
 */
export interface ChatGPTTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  /** ChatGPT account id (`chatgpt_account_id` claim), sent as a request header. */
  accountId?: string;
  /** Epoch milliseconds at which `accessToken` expires, when known. */
  expiresAt?: number;
}

/** Public profile derived from the id token — safe to expose to the browser. */
export interface ChatGPTUser {
  accountId: string;
  email?: string;
  name?: string;
  /** ChatGPT plan, e.g. `"free"`, `"plus"`, `"pro"`, when present in the token. */
  plan?: string;
}

/**
 * A pending device-code login. Show {@link userCode} to the user and send them
 * to {@link verificationUrl}; the backend then polls until they authorize.
 */
export interface DeviceCode {
  /** Opaque handle used when polling for completion. */
  deviceAuthId: string;
  /** Short human-enterable code (e.g. `7B0J-DPK78`). */
  userCode: string;
  /** URL the user opens to enter {@link userCode}. */
  verificationUrl: string;
  /** Minimum seconds to wait between polls. */
  interval: number;
  /** Epoch milliseconds after which the code is no longer valid. */
  expiresAt: number;
}

/** Result of a single device-token poll. */
export type DevicePollResult =
  | { status: "pending" }
  | {
      status: "authorized";
      authorizationCode: string;
      codeChallenge: string;
      codeVerifier: string;
    };

/** High-level status of a login session, shared between server and client. */
export type LoginStatus =
  | "unauthenticated"
  | "pending"
  | "authenticated"
  | "expired"
  | "error";

/** A PKCE verifier/challenge pair (S256). */
export interface PkcePair {
  verifier: string;
  challenge: string;
}
