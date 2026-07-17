import {
  DEFAULT_CLIENT_ID,
  DEFAULT_CLIENT_VERSION,
  DEFAULT_CODEX_BASE_URL,
  DEFAULT_ISSUER,
  DEFAULT_ORIGINATOR,
  DEFAULT_REALTIME_BASE_URL,
  DEFAULT_REALTIME_CLIENT_BUILD,
  DEFAULT_REALTIME_CLIENT_VERSION,
  DEFAULT_REALTIME_WEB_CLIENT_ID,
  DEFAULT_SCOPE,
} from "./constants.ts";
import type { FetchLike } from "./types.ts";

/**
 * Overridable configuration for every auth/transport call. All fields are
 * optional; sensible Codex defaults are applied by {@link resolveConfig}.
 */
export interface ChatGPTConfig {
  /** OAuth client id. Defaults to the public Codex CLI client. */
  clientId?: string;
  /** Authorization server origin. Defaults to `https://auth.openai.com`. */
  issuer?: string;
  /** OAuth scopes. Defaults to `openid profile email offline_access`. */
  scope?: string;
  /** Codex model API base URL. Defaults to `https://chatgpt.com/backend-api/codex`. */
  codexBaseUrl?: string;
  /** ChatGPT web origin used by the unsupported private voice transport. */
  realtimeBaseUrl?: string;
  /** ChatGPT web client identifier sent to the Realtime edge. */
  realtimeClientVersion?: string;
  /** ChatGPT web build number sent to the Realtime edge. */
  realtimeClientBuild?: string;
  /** Expected client id in access tokens minted from a ChatGPT web session. */
  realtimeWebClientId?: string;
  /** `originator` value identifying the client. Defaults to `codex_cli_rs`. */
  originator?: string;
  /**
   * Codex client version sent as `client_version`. The ChatGPT backend gates
   * the available models on this. Defaults to a current value.
   */
  clientVersion?: string;
  /** Custom fetch (for testing, proxies, or non-standard runtimes). */
  fetch?: FetchLike;
}

/** Fully-resolved configuration with all defaults applied and URLs normalized. */
export interface ResolvedConfig {
  clientId: string;
  issuer: string;
  scope: string;
  codexBaseUrl: string;
  realtimeBaseUrl: string;
  realtimeClientVersion: string;
  realtimeClientBuild: string;
  realtimeWebClientId: string;
  originator: string;
  clientVersion: string;
  fetch: FetchLike;
  /** OAuth token endpoint (`{issuer}/oauth/token`). */
  tokenUrl: string;
  /** OAuth authorization endpoint (`{issuer}/oauth/authorize`). */
  authorizeUrl: string;
  /** Device-auth API base (`{issuer}/api/accounts`). */
  deviceApiBase: string;
  /** User-facing device verification page (`{issuer}/codex/device`). */
  deviceVerificationUrl: string;
  /** Redirect URI used to exchange a device authorization code. */
  deviceRedirectUri: string;
}

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

function resolveFetch(custom?: FetchLike): FetchLike {
  if (typeof custom === "function") return custom;
  if (typeof globalThis.fetch === "function") return globalThis.fetch.bind(globalThis);
  throw new TypeError(
    "No fetch implementation available. Pass `fetch` in the config on runtimes without a global fetch.",
  );
}

/** Applies defaults and derives every endpoint URL from the issuer. */
export function resolveConfig(config: ChatGPTConfig = {}): ResolvedConfig {
  const issuer = stripTrailingSlash(config.issuer ?? DEFAULT_ISSUER);
  return {
    clientId: config.clientId ?? DEFAULT_CLIENT_ID,
    issuer,
    scope: config.scope ?? DEFAULT_SCOPE,
    codexBaseUrl: stripTrailingSlash(config.codexBaseUrl ?? DEFAULT_CODEX_BASE_URL),
    realtimeBaseUrl: stripTrailingSlash(config.realtimeBaseUrl ?? DEFAULT_REALTIME_BASE_URL),
    realtimeClientVersion: config.realtimeClientVersion ?? DEFAULT_REALTIME_CLIENT_VERSION,
    realtimeClientBuild: config.realtimeClientBuild ?? DEFAULT_REALTIME_CLIENT_BUILD,
    realtimeWebClientId: config.realtimeWebClientId ?? DEFAULT_REALTIME_WEB_CLIENT_ID,
    originator: config.originator ?? DEFAULT_ORIGINATOR,
    clientVersion: config.clientVersion ?? DEFAULT_CLIENT_VERSION,
    fetch: resolveFetch(config.fetch),
    tokenUrl: `${issuer}/oauth/token`,
    authorizeUrl: `${issuer}/oauth/authorize`,
    deviceApiBase: `${issuer}/api/accounts`,
    deviceVerificationUrl: `${issuer}/codex/device`,
    deviceRedirectUri: `${issuer}/deviceauth/callback`,
  };
}
