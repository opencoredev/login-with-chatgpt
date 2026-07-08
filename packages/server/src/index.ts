/**
 * @loginwithchatgpt/server
 *
 * Backend that hosts the Login with ChatGPT flow. Returns a single
 * Web-standard `(Request) => Response` handler you mount at a base path; it
 * exposes device login, status polling, logout, model discovery, and an
 * authenticated Codex responses proxy. Sessions are cookie-based and tokens
 * stay server-side.
 */

export {
  createChatGPTHandler,
  type CreateChatGPTHandlerOptions,
  type ChatGPTHandler,
  type GetTokensOptions,
  type PublicSession,
  type RateLimitBucket,
  type ResponsesProxyPolicy,
  type ResponsesRateLimit,
} from "./handler.ts";
export {
  SessionManager,
  type SessionManagerOptions,
  type SessionData,
  type StoredSession,
  type DeviceState,
} from "./session.ts";
export { readCookie, serializeCookie, type CookieOptions } from "./cookies.ts";
export { sign, unsign, encryptJson, decryptJson } from "./crypto.ts";

// Re-export common core types so consumers can build stores/providers without
// a second import.
export {
  type ChatGPTConfig,
  type ChatGPTTokens,
  type ChatGPTUser,
  type KeyValueStore,
  type LoginStatus,
  MemoryStore,
} from "@loginwithchatgpt/core";
