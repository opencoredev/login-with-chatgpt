import {
  type ChatGPTTokens,
  type ChatGPTUser,
  type DeviceCode,
  type KeyValueStore,
  type LoginStatus,
  type ResolvedConfig,
  ChatGPTAuthError,
  ensureFreshTokens,
  exchangeDeviceAuthorization,
  parseUser,
  pollDeviceCode,
  requestDeviceCode,
} from "@loginwithchatgpt/core";
import { decryptJson, encryptJson } from "./crypto.ts";

/**
 * Store TTL for sessions that have not authenticated yet. A device code is only
 * valid for ~15 minutes, so a pending session is dead weight after that; this
 * bounds how long unauthenticated `POST /login` entries can occupy the store.
 */
const PENDING_SESSION_TTL_MS = 30 * 60 * 1000;

/** Pending device-code state persisted between status polls. */
export interface DeviceState {
  deviceAuthId: string;
  userCode: string;
  verificationUrl: string;
  interval: number;
  expiresAt: number;
  lastPolledAt: number;
}

/** In-memory shape of a login session. */
export interface SessionData {
  status: LoginStatus;
  device?: DeviceState;
  tokens?: ChatGPTTokens;
  user?: ChatGPTUser;
  createdAt: number;
  updatedAt: number;
}

/** Persisted shape — tokens are encrypted at rest when a secret is configured. */
export interface StoredSession {
  status: LoginStatus;
  device?: DeviceState;
  tokensCipher?: string;
  tokensPlain?: ChatGPTTokens;
  user?: ChatGPTUser;
  createdAt: number;
  updatedAt: number;
}

export interface SessionManagerOptions {
  config: ResolvedConfig;
  store: KeyValueStore<StoredSession>;
  sessionTtlMs: number;
  /** When set, tokens are AES-GCM encrypted before hitting the store. */
  secret?: string;
  now?: () => number;
}

/**
 * Owns session persistence and login progression. The device flow is advanced
 * one poll per {@link advance} call and never blocks, so it is safe on
 * serverless runtimes where each request is a fresh invocation.
 */
export class SessionManager {
  private readonly config: ResolvedConfig;
  private readonly store: KeyValueStore<StoredSession>;
  private readonly ttlMs: number;
  private readonly secret?: string;
  private readonly now: () => number;

  constructor(options: SessionManagerOptions) {
    this.config = options.config;
    this.store = options.store;
    this.ttlMs = options.sessionTtlMs;
    this.secret = options.secret;
    this.now = options.now ?? Date.now;
  }

  async load(sessionId: string): Promise<SessionData | undefined> {
    const stored = await this.store.get(sessionId);
    if (!stored) return undefined;
    let tokens = stored.tokensPlain;
    if (!tokens && stored.tokensCipher && this.secret) {
      tokens = await decryptJson<ChatGPTTokens>(stored.tokensCipher, this.secret);
    }
    return {
      status: stored.status,
      device: stored.device,
      tokens,
      user: stored.user,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    };
  }

  async save(sessionId: string, data: SessionData): Promise<void> {
    const stored: StoredSession = {
      status: data.status,
      device: data.device,
      user: data.user,
      createdAt: data.createdAt,
      updatedAt: this.now(),
    };
    if (data.tokens) {
      if (this.secret) stored.tokensCipher = await encryptJson(data.tokens, this.secret);
      else stored.tokensPlain = data.tokens;
    }
    // A session that hasn't authenticated yet (no tokens) is only useful while
    // its device code is alive (~15 min). `POST /login` is unauthenticated, so
    // giving these the full session TTL would let anyone pile up long-lived
    // junk entries in the store. Expire them quickly; authenticated sessions
    // (with tokens) get the full TTL and each save renews it.
    const ttlMs = data.tokens ? this.ttlMs : Math.min(this.ttlMs, PENDING_SESSION_TTL_MS);
    await this.store.set(sessionId, stored, { ttlMs });
  }

  async delete(sessionId: string): Promise<void> {
    await this.store.delete(sessionId);
  }

  /**
   * Starts (or reuses) a device login. If a code is still valid it is returned
   * again so repeated clicks don't invalidate the user's in-progress code.
   */
  async startDeviceLogin(sessionId: string): Promise<{ device: DeviceCode; data: SessionData }> {
    const existing = await this.load(sessionId);
    if (existing?.device && existing.device.expiresAt > this.now()) {
      return { device: toDeviceCode(existing.device), data: existing };
    }

    const device = await requestDeviceCode(this.config, this.now);
    const data: SessionData = {
      status: "pending",
      device: {
        deviceAuthId: device.deviceAuthId,
        userCode: device.userCode,
        verificationUrl: device.verificationUrl,
        interval: device.interval,
        expiresAt: device.expiresAt,
        lastPolledAt: 0,
      },
      createdAt: existing?.createdAt ?? this.now(),
      updatedAt: this.now(),
    };
    await this.save(sessionId, data);
    return { device, data };
  }

  /**
   * Progresses a session: refreshes tokens when authenticated, or performs at
   * most one device poll (respecting the interval) when a login is pending.
   */
  async advance(sessionId: string): Promise<SessionData> {
    const data = await this.load(sessionId);
    if (!data) return emptySession(this.now());

    if (data.tokens) {
      try {
        const fresh = await ensureFreshTokens(this.config, data.tokens, {
          now: this.now,
          onRefresh: async (tokens) => {
            data.tokens = tokens;
          },
        });
        data.tokens = fresh;
        data.status = "authenticated";
        data.user ??= fresh.idToken ? parseUser(fresh.idToken) : undefined;
        await this.save(sessionId, data);
        return data;
      } catch (error) {
        if (error instanceof ChatGPTAuthError && error.code === "refresh_token_invalid") {
          await this.delete(sessionId);
          return { ...emptySession(this.now()), status: "expired" };
        }
        throw error;
      }
    }

    if (data.device) {
      if (this.now() >= data.device.expiresAt) {
        data.status = "expired";
        data.device = undefined;
        await this.save(sessionId, data);
        return data;
      }
      const sinceLastPoll = this.now() - data.device.lastPolledAt;
      if (sinceLastPoll < data.device.interval * 1000) {
        return data; // rate-limit polling to the server-provided interval
      }

      data.device.lastPolledAt = this.now();
      const result = await pollDeviceCode(this.config, data.device);
      if (result.status === "authorized") {
        const tokens = await exchangeDeviceAuthorization(this.config, result);
        data.tokens = tokens;
        data.user = tokens.idToken ? parseUser(tokens.idToken) : undefined;
        data.status = "authenticated";
        data.device = undefined;
      }
      await this.save(sessionId, data);
      return data;
    }

    return data;
  }

  /**
   * In-flight guard for {@link getFreshTokens}: OpenAI rotates refresh tokens,
   * so two concurrent refreshes for the same session can invalidate each other
   * and force a re-login. Per-instance only — multi-instance deployments rely
   * on the shared store persisting whichever rotation lands last.
   */
  private readonly inflight = new Map<string, Promise<ChatGPTTokens | undefined>>();

  /** Returns fresh tokens for API calls, or `undefined` when not signed in. */
  getFreshTokens(sessionId: string): Promise<ChatGPTTokens | undefined> {
    const pending = this.inflight.get(sessionId);
    if (pending) return pending;
    const promise = this.loadFreshTokens(sessionId).finally(() => {
      this.inflight.delete(sessionId);
    });
    this.inflight.set(sessionId, promise);
    return promise;
  }

  private async loadFreshTokens(sessionId: string): Promise<ChatGPTTokens | undefined> {
    const data = await this.load(sessionId);
    if (!data?.tokens) return undefined;
    const fresh = await ensureFreshTokens(this.config, data.tokens, {
      now: this.now,
      onRefresh: async (tokens) => {
        data.tokens = tokens;
        await this.save(sessionId, data);
      },
    });
    return fresh;
  }
}

function emptySession(now: number): SessionData {
  return { status: "unauthenticated", createdAt: now, updatedAt: now };
}

function toDeviceCode(state: DeviceState): DeviceCode {
  return {
    deviceAuthId: state.deviceAuthId,
    userCode: state.userCode,
    verificationUrl: state.verificationUrl,
    interval: state.interval,
    expiresAt: state.expiresAt,
  };
}
