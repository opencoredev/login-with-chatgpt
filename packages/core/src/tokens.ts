import type { ResolvedConfig } from "./config.ts";
import { ChatGPTAuthError } from "./errors.ts";
import { deriveAccountId, getTokenExpiry } from "./jwt.ts";
import { refreshTokens } from "./oauth.ts";
import type { ChatGPTTokens } from "./types.ts";

/** Refresh when the access token is within this window of expiring. */
const EXPIRY_MARGIN_MS = 60 * 1000;

/** `true` when the access token is missing, expired, or about to expire. */
export function isAccessTokenExpired(tokens: ChatGPTTokens, now: () => number = Date.now): boolean {
  if (!tokens.accessToken) return true;
  const expiresAt = tokens.expiresAt ?? getTokenExpiry(tokens.accessToken);
  if (typeof expiresAt !== "number") return false;
  return expiresAt <= now() + EXPIRY_MARGIN_MS;
}

export interface EnsureFreshOptions {
  now?: () => number;
  /** Persist refreshed tokens (e.g. back to a session store). */
  onRefresh?: (tokens: ChatGPTTokens) => void | Promise<void>;
  /** Force a refresh even if the current token still looks valid. */
  force?: boolean;
}

/**
 * Returns tokens guaranteed fresh enough to make an API call, refreshing via
 * the refresh token when needed and reporting the new tokens through
 * `onRefresh`. Throws `not_authenticated` when nothing usable is available.
 */
export async function ensureFreshTokens(
  config: ResolvedConfig,
  tokens: ChatGPTTokens | undefined,
  options: EnsureFreshOptions = {},
): Promise<ChatGPTTokens> {
  const now = options.now ?? Date.now;

  if (tokens?.accessToken && !options.force && !isAccessTokenExpired(tokens, now)) {
    return withAccountId(tokens);
  }

  if (!tokens?.refreshToken) {
    if (tokens?.accessToken) return withAccountId(tokens);
    throw new ChatGPTAuthError("not_authenticated", "No ChatGPT credentials available. The user must sign in.");
  }

  const refreshed = withAccountId(await refreshTokens(config, tokens.refreshToken));
  await options.onRefresh?.(refreshed);
  return refreshed;
}

/** Ensures `accountId` is populated by deriving it from the tokens when missing. */
function withAccountId(tokens: ChatGPTTokens): ChatGPTTokens {
  if (tokens.accountId) return tokens;
  const accountId = deriveAccountId(tokens.idToken) ?? deriveAccountId(tokens.accessToken);
  return accountId ? { ...tokens, accountId } : tokens;
}
