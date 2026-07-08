/** Discriminates {@link ChatGPTAuthError} instances without `instanceof`. */
export type ChatGPTAuthErrorCode =
  | "device_code_request_failed"
  | "device_code_disabled"
  | "authorization_pending"
  | "authorization_expired"
  | "token_exchange_failed"
  | "token_refresh_failed"
  | "refresh_token_invalid"
  | "not_authenticated"
  | "invalid_token"
  | "network_error"
  | "models_request_failed"
  | "responses_request_failed";

/**
 * Error raised by every auth/transport operation in this package. Carries a
 * stable {@link ChatGPTAuthErrorCode} plus the upstream HTTP status and body
 * when one is available, so callers can branch without string matching.
 */
export class ChatGPTAuthError extends Error {
  readonly code: ChatGPTAuthErrorCode;
  readonly status?: number;
  readonly body?: string;

  constructor(
    code: ChatGPTAuthErrorCode,
    message: string,
    options: { status?: number; body?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ChatGPTAuthError";
    this.code = code;
    this.status = options.status;
    this.body = options.body;
  }
}

/** `true` when the refresh token can no longer be used and the user must re-authenticate. */
export function isRefreshTokenInvalid(error: unknown): boolean {
  return error instanceof ChatGPTAuthError && error.code === "refresh_token_invalid";
}
