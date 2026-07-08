import type { ResolvedConfig } from "./config.ts";
import { DEVICE_CODE_TTL_MS } from "./constants.ts";
import { ChatGPTAuthError } from "./errors.ts";
import { exchangeAuthorizationCode } from "./oauth.ts";
import type { ChatGPTTokens, DeviceCode, DevicePollResult } from "./types.ts";

/**
 * The device-authorization flow (the cloud-friendly path shown in the demo).
 *
 * Unlike the loopback PKCE flow it needs no redirect listener, so it works on
 * servers, containers, and serverless functions:
 *
 * 1. {@link requestDeviceCode} — get a short `userCode` + a verification URL.
 * 2. Show them to the user; they open the URL and enter the code.
 * 3. {@link pollDeviceCode} — poll until OpenAI returns an authorization code.
 * 4. That poll's success is exchanged for tokens automatically by
 *    {@link waitForDeviceTokens}, or manually via {@link exchangeAuthorizationCode}.
 */

interface RawUserCodeResponse {
  device_auth_id?: string;
  user_code?: string;
  usercode?: string;
  interval?: string | number;
}

interface RawTokenPollResponse {
  authorization_code?: string;
  code_challenge?: string;
  code_verifier?: string;
}

/** Requests a fresh device code from OpenAI. */
export async function requestDeviceCode(
  config: ResolvedConfig,
  now: () => number = Date.now,
): Promise<DeviceCode> {
  const url = `${config.deviceApiBase}/deviceauth/usercode`;
  let response: Response;
  try {
    response = await config.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: config.clientId }),
    });
  } catch (cause) {
    throw new ChatGPTAuthError("network_error", "Failed to reach the device authorization endpoint.", { cause });
  }

  if (response.status === 404) {
    throw new ChatGPTAuthError("device_code_disabled", "Device-code login is not enabled for this server. Verify the issuer URL or use the redirect flow.", { status: 404 });
  }
  if (!response.ok) {
    throw new ChatGPTAuthError("device_code_request_failed", `Device code request failed (${response.status}).`, {
      status: response.status,
      body: await safeText(response),
    });
  }

  const raw = (await response.json()) as RawUserCodeResponse;
  const userCode = raw.user_code ?? raw.usercode;
  if (!raw.device_auth_id || !userCode) {
    throw new ChatGPTAuthError("device_code_request_failed", "Device code response was missing required fields.");
  }

  return {
    deviceAuthId: raw.device_auth_id,
    userCode,
    verificationUrl: config.deviceVerificationUrl,
    interval: normalizeInterval(raw.interval),
    expiresAt: now() + DEVICE_CODE_TTL_MS,
  };
}

/**
 * Polls once for device-authorization completion.
 *
 * Returns `{ status: "pending" }` while the user has not finished, or
 * `{ status: "authorized", ... }` with the authorization code and the
 * server-generated PKCE pair to exchange for tokens.
 */
export async function pollDeviceCode(
  config: ResolvedConfig,
  device: Pick<DeviceCode, "deviceAuthId" | "userCode">,
): Promise<DevicePollResult> {
  const url = `${config.deviceApiBase}/deviceauth/token`;
  let response: Response;
  try {
    response = await config.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ device_auth_id: device.deviceAuthId, user_code: device.userCode }),
    });
  } catch (cause) {
    throw new ChatGPTAuthError("network_error", "Failed to reach the device token endpoint.", { cause });
  }

  // 403/404 are the documented "keep waiting" responses. 429 is a transient
  // Cloudflare rate-limit/challenge on the polling endpoint — also retryable.
  if (response.status === 403 || response.status === 404 || response.status === 429) {
    return { status: "pending" };
  }
  if (!response.ok) {
    throw new ChatGPTAuthError("token_exchange_failed", `Device authorization failed (${response.status}).`, {
      status: response.status,
      body: await safeText(response),
    });
  }

  const raw = (await response.json()) as RawTokenPollResponse;
  if (!raw.authorization_code || !raw.code_verifier || !raw.code_challenge) {
    // A 200 without a code means it is still binding — treat as pending.
    return { status: "pending" };
  }
  return {
    status: "authorized",
    authorizationCode: raw.authorization_code,
    codeChallenge: raw.code_challenge,
    codeVerifier: raw.code_verifier,
  };
}

/** Exchanges a successful device poll for tokens. */
export function exchangeDeviceAuthorization(
  config: ResolvedConfig,
  poll: Extract<DevicePollResult, { status: "authorized" }>,
): Promise<ChatGPTTokens> {
  return exchangeAuthorizationCode(config, {
    code: poll.authorizationCode,
    codeVerifier: poll.codeVerifier,
    redirectUri: config.deviceRedirectUri,
  });
}

export interface WaitForDeviceTokensOptions {
  /** Abort the wait (e.g. on request cancellation). */
  signal?: AbortSignal;
  /** Called before each poll attempt — useful for logging/telemetry. */
  onPoll?: (attempt: number) => void;
  /** Overrides the poll cadence; defaults to the device code's interval. */
  intervalMs?: number;
  /** Injectable clock/sleep for testing. */
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Blocks until the user authorizes the device or the code expires. Intended for
 * long-lived servers/CLIs; serverless handlers should drive {@link pollDeviceCode}
 * across separate requests instead.
 */
export async function waitForDeviceTokens(
  config: ResolvedConfig,
  device: DeviceCode,
  options: WaitForDeviceTokensOptions = {},
): Promise<ChatGPTTokens> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const intervalMs = options.intervalMs ?? device.interval * 1000;
  let attempt = 0;

  while (now() < device.expiresAt) {
    if (options.signal?.aborted) {
      throw new ChatGPTAuthError("authorization_expired", "Device authorization was aborted.");
    }
    options.onPoll?.(++attempt);
    const result = await pollDeviceCode(config, device);
    if (result.status === "authorized") {
      return exchangeDeviceAuthorization(config, result);
    }
    await sleep(intervalMs, options.signal);
  }

  throw new ChatGPTAuthError("authorization_expired", "Device authorization expired before the user completed sign-in.");
}

function normalizeInterval(value: string | number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 5;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ChatGPTAuthError("authorization_expired", "Device authorization was aborted."));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ChatGPTAuthError("authorization_expired", "Device authorization was aborted."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
