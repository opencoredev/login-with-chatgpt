/**
 * Wire-protocol constants for the ChatGPT (Codex) OAuth flow.
 *
 * These mirror the public OpenAI Codex CLI client. Logging in with them grants
 * access to the end user's own ChatGPT plan (Free/Plus/Pro) — usage is billed
 * to that user, never to the app developer. Every value here is overridable
 * through {@link ChatGPTConfig} so the SDK keeps working if OpenAI moves an
 * endpoint.
 */

/** Public OAuth client id used by the Codex CLI. */
export const DEFAULT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

/** OAuth issuer / authorization server origin. */
export const DEFAULT_ISSUER = "https://auth.openai.com";

/** OAuth scopes required to obtain a refreshable ChatGPT session. */
export const DEFAULT_SCOPE = "openid profile email offline_access";

/** Base URL of the ChatGPT-backed Codex model API. */
export const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";

/** `originator` header/param value that identifies the client to OpenAI. */
export const DEFAULT_ORIGINATOR = "codex_cli_rs";

/** Redirect URI for the local (loopback) PKCE flow. */
export const DEFAULT_LOOPBACK_REDIRECT_URI = "http://localhost:1455/auth/callback";

/** JWT claim namespace that carries ChatGPT account/plan metadata. */
export const AUTH_CLAIM = "https://api.openai.com/auth";

/** Device codes expire server-side ~15 minutes after issue. */
export const DEVICE_CODE_TTL_MS = 15 * 60 * 1000;

/**
 * Default model used by the Codex responses API when the caller omits one.
 * Supported models depend on the user's plan and the `client_version` sent;
 * query the models endpoint for the authoritative list.
 */
export const DEFAULT_MODEL = "gpt-5.5";

/**
 * Codex client version sent as the `client_version` query parameter. The
 * ChatGPT backend gates the available model set on this — omitting it (or
 * sending a stale value) makes every model report as "not supported". Bump
 * this toward the current Codex CLI release if models disappear.
 */
export const DEFAULT_CLIENT_VERSION = "0.142.5";

/** Default system instructions sent to the Codex responses API. */
export const DEFAULT_CODEX_INSTRUCTIONS =
  "You are a helpful assistant powered by the user's ChatGPT account. Answer the user's request directly and helpfully.";

/**
 * The Codex backend runs stateless (`store: false`), so reasoning continuity is
 * carried in encrypted reasoning content that must be explicitly requested.
 */
export const REASONING_ENCRYPTED_CONTENT = "reasoning.encrypted_content";
