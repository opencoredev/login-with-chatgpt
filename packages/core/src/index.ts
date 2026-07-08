/**
 * @loginwithchatgpt/core
 *
 * Framework-agnostic engine for "Login with ChatGPT". Implements OpenAI's
 * device-code and loopback PKCE OAuth flows, token refresh, JWT/account
 * derivation, and the Codex responses transport. Depends only on Web-standard
 * `fetch` and `crypto`, so it runs in browsers, Bun, Node 18+, and edge runtimes.
 */

export * from "./constants.ts";
export * from "./types.ts";
export * from "./errors.ts";
export { type ChatGPTConfig, type ResolvedConfig, resolveConfig } from "./config.ts";
export {
  base64UrlEncode,
  base64UrlDecodeToBytes,
  base64UrlDecodeToString,
} from "./internal/base64.ts";
export { randomToken, createState, generatePkce } from "./pkce.ts";
export { decodeJwt, getTokenExpiry, deriveAccountId, parseUser } from "./jwt.ts";
export {
  createAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshTokens,
} from "./oauth.ts";
export {
  requestDeviceCode,
  pollDeviceCode,
  exchangeDeviceAuthorization,
  waitForDeviceTokens,
  type WaitForDeviceTokensOptions,
} from "./device.ts";
export { isAccessTokenExpired, ensureFreshTokens, type EnsureFreshOptions } from "./tokens.ts";
export { type KeyValueStore, MemoryStore } from "./store.ts";
export {
  type CodexAuth,
  type CodexFetchOptions,
  type CodexResponsesOptions,
  type CodexServiceTier,
  type ListCodexModelsOptions,
  type ReasoningEffort,
  createCodexFetch,
  listCodexModels,
  extractCodexModelSlugs,
  normalizeResponsesBody,
  filterCodexInput,
  resolveTargetUrl,
} from "./codex-transport.ts";
