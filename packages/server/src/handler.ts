import {
  type ChatGPTConfig,
  type ChatGPTTokens,
  type ChatGPTUser,
  type CodexServiceTier,
  type CodexResponsesOptions,
  type KeyValueStore,
  type LoginStatus,
  type ChatGPTRealtimeSessionOptions,
  type ChatGPTRealtimeAuth,
  type ChatGPTRealtimeVoiceMode,
  type ReasoningEffort,
  DEFAULT_MODEL,
  ChatGPTAuthError,
  MemoryStore,
  createCodexFetch,
  createChatGPTRealtimeCall,
  listCodexModels,
  randomToken,
  resolveConfig,
} from "@opencoredev/loginwithchatgpt-core";
import { type CookieOptions, readCookie, serializeCookie } from "./cookies.ts";
import { sign, unsign } from "./crypto.ts";
import { SessionManager, type StoredSession } from "./session.ts";

const DEFAULT_BASE_PATH = "/api/chatgpt";
const DEFAULT_COOKIE_NAME = "lwc_session";
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_RESPONSES_BODY_BYTES = 40 * 1024 * 1024;
const DEFAULT_RESPONSES_RATE_LIMIT = 30;
const DEFAULT_RESPONSES_RATE_WINDOW_MS = 60 * 1000;
const DEFAULT_MAX_REALTIME_BODY_BYTES = 256 * 1024;
const SERVICE_TIER_HEADER = "x-login-with-chatgpt-service-tier";
const REASONING_EFFORT_HEADER = "x-login-with-chatgpt-reasoning-effort";
const SERVICE_TIERS = new Set<CodexServiceTier>(["auto", "default", "flex", "priority", "fast"]);
const REASONING_EFFORTS = new Set<ReasoningEffort>(["none", "low", "medium", "high", "xhigh"]);

export interface ResponsesProxyPolicy {
  /**
   * Restrict which model ids the built-in `/responses` proxy will accept. Leave
   * unset to allow any model returned/accepted by the signed-in account.
   */
  allowedModels?: readonly string[] | ((model: string) => boolean);
  /** Maximum raw JSON request body accepted by `/responses`. Defaults to 40 MiB for image editing inputs. */
  maxRequestBytes?: number;
  /**
   * Per-session rate limit for the `/responses` proxy. Requests through the
   * proxy consume the signed-in user's own ChatGPT plan, so this is on by
   * default (30 requests/minute) to keep runaway or abusive client code from
   * burning their usage. Set `false` to disable when you rate limit elsewhere.
   */
  rateLimit?: false | ResponsesRateLimit;
}

export interface ResponsesRateLimit {
  /** Max `/responses` requests per session per window. Defaults to 30. */
  limit?: number;
  /** Window length in milliseconds. Defaults to 60 seconds. */
  windowMs?: number;
  /**
   * Backing store for rate counters. Defaults to an in-memory store; use a
   * shared store when running multiple instances so limits apply globally.
   */
  store?: KeyValueStore<RateLimitBucket>;
}

export interface RealtimeProxyPolicy {
  /** Maximum JSON signaling request size. Defaults to 256 KiB. */
  maxRequestBytes?: number;
  /** Voice modes the browser may request. Defaults to both modes. */
  allowedModes?: readonly ChatGPTRealtimeVoiceMode[];
  /** Server defaults merged before browser session options. */
  sessionDefaults?: ChatGPTRealtimeSessionOptions;
  /**
   * Supplies a short-lived ChatGPT web-client token for `/wm`. The normal
   * Codex device-login token is intentionally not reused because OpenAI rejects
   * it for GPT Live. Resolve this from an encrypted, user-bound web session.
   */
  getAuth?: (context: {
    request: Request;
    sessionId: string;
    transport: "wm" | "vp" | "vps";
  }) => Promise<ChatGPTRealtimeAuth> | ChatGPTRealtimeAuth;
}

/** Fixed-window rate counter persisted per session id. */
export interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export interface CreateChatGPTHandlerOptions extends ChatGPTConfig, CodexResponsesOptions {
  /** Path the handler is mounted at. Defaults to `/api/chatgpt`. */
  basePath?: string;
  /**
   * Secret used to sign session cookies and encrypt tokens at rest. Strongly
   * recommended in production; without one an ephemeral secret is generated and
   * sessions won't survive a restart or span instances.
   */
  secret?: string;
  /** Session backing store. Defaults to an in-memory store (dev/single-instance). */
  sessionStore?: KeyValueStore<StoredSession>;
  /** Session cookie name. Defaults to `lwc_session`. */
  cookieName?: string;
  /** Overrides for the session cookie attributes. */
  cookie?: Partial<CookieOptions>;
  /** Session lifetime. Defaults to 30 days. */
  sessionTtlMs?: number;
  /** Default model injected when a `/responses` request omits one. */
  defaultModel?: string;
  /** Set `false` to disable the built-in `/responses` proxy. Defaults to `true`. */
  enableResponsesProxy?: boolean;
  /** Set `false` to disable the built-in `/realtime` signaling route. Defaults to `true`. */
  enableRealtime?: boolean;
  /** Guardrails and defaults for ChatGPT Realtime signaling. */
  realtime?: RealtimeProxyPolicy;
  /** Guardrails for the built-in `/responses` proxy. */
  responsesProxy?: ResponsesProxyPolicy;
  /**
   * Extra origins (e.g. `https://app.example.com`) allowed to send
   * cookie-authenticated non-GET requests, for cross-origin frontend/backend
   * deployments. Browser requests from any other origin are rejected with 403
   * so third-party sites can never ride the session cookie, even when it is
   * configured `SameSite=None`. Same-origin requests and requests without an
   * `Origin` header (non-browser clients) are always allowed.
   */
  allowedOrigins?: readonly string[];
  /**
   * Allows raw bearer-token export to application code through
   * `dangerouslyGetTokens()` / deprecated `getTokens()`. Leave disabled for the
   * normal self-hosted security model: use `/responses`, `/models`, or
   * `proxyFetch(request)` so credentials stay inside this handler.
   */
  dangerouslyAllowTokenExport?: boolean;
  /**
   * Allows exporting the long-lived refresh token as well. Requires
   * `dangerouslyAllowTokenExport` and should only be used for deliberate
   * migration/export flows.
   */
  dangerouslyAllowRefreshTokenExport?: boolean;
  now?: () => number;
}

/** Login state safe to return to the browser. */
export interface PublicSession {
  status: LoginStatus;
  user?: ChatGPTUser;
}

export interface GetTokensOptions {
  /**
   * Also return the long-lived refresh token. Disabled unless
   * `dangerouslyAllowRefreshTokenExport` is set. Only opt in when you genuinely
   * need to export the session, such as a controlled store migration.
   */
  includeRefreshToken?: boolean;
}

export interface ChatGPTHandler {
  basePath: string;
  /** Handles a request routed to `${basePath}/*`. Returns 404 for unknown routes. */
  handler: (request: Request) => Promise<Response>;
  /** Alias of {@link handler} for `Bun.serve`/`fetch`-style mounting. */
  fetch: (request: Request) => Promise<Response>;
  /**
   * Creates a fetch implementation bound to the current request's session.
   * Pass it to `createChatGPTProxyProvider({ fetch: auth.proxyFetch(request) })`
   * from server routes that need AI SDK control without receiving raw tokens.
   */
  proxyFetch: (request: Request) => typeof fetch;
  /** Reads the current session (status + public user) for server-side rendering. */
  getSession: (request: Request) => Promise<PublicSession>;
  /**
   * @deprecated Prefer `/responses`, `/models`, or `proxyFetch(request)`.
   * Requires `dangerouslyAllowTokenExport` because it returns bearer material
   * application code can log or exfiltrate.
   */
  getTokens: (request: Request, options?: GetTokensOptions) => Promise<ChatGPTTokens | undefined>;
  /**
   * Explicit raw-token escape hatch. Requires `dangerouslyAllowTokenExport`.
   * The refresh token is still redacted unless
   * `dangerouslyAllowRefreshTokenExport` is also set.
   */
  dangerouslyGetTokens: (request: Request, options?: GetTokensOptions) => Promise<ChatGPTTokens | undefined>;
  /** Returns the signed-in account's available model slugs. */
  getModels: (request: Request) => Promise<string[] | undefined>;
}

/**
 * Creates the backend that hosts the Login with ChatGPT flow. Mount
 * {@link ChatGPTHandler.handler} at `${basePath}/*` on any Web-standard runtime
 * (Bun, Next.js route handlers, Hono, Cloudflare Workers, Deno, …).
 */
export function createChatGPTHandler(options: CreateChatGPTHandlerOptions = {}): ChatGPTHandler {
  const config = resolveConfig(options);
  const basePath = normalizeBasePath(options.basePath ?? DEFAULT_BASE_PATH);
  const cookieName = options.cookieName ?? DEFAULT_COOKIE_NAME;
  const now = options.now ?? Date.now;
  const secret = options.secret ?? createEphemeralSecret();
  const defaultModel = options.defaultModel ?? DEFAULT_MODEL;
  const enableResponsesProxy = options.enableResponsesProxy ?? true;
  const enableRealtime = options.enableRealtime ?? true;
  const responsesProxy = options.responsesProxy ?? {};
  const realtime = options.realtime ?? {};
  const maxResponsesBodyBytes = responsesProxy.maxRequestBytes ?? DEFAULT_MAX_RESPONSES_BODY_BYTES;
  const maxRealtimeBodyBytes = realtime.maxRequestBytes ?? DEFAULT_MAX_REALTIME_BODY_BYTES;

  const allowedOrigins = new Set<string>();
  for (const origin of options.allowedOrigins ?? []) {
    try {
      allowedOrigins.add(new URL(origin).origin);
    } catch {
      throw new TypeError(`Invalid origin in allowedOrigins: "${origin}". Expected e.g. "https://app.example.com".`);
    }
  }

  const rateLimit =
    responsesProxy.rateLimit === false
      ? undefined
      : {
          limit: responsesProxy.rateLimit?.limit ?? DEFAULT_RESPONSES_RATE_LIMIT,
          windowMs: responsesProxy.rateLimit?.windowMs ?? DEFAULT_RESPONSES_RATE_WINDOW_MS,
          store: responsesProxy.rateLimit?.store ?? new MemoryStore<RateLimitBucket>({ now }),
        };

  const sessions = new SessionManager({
    config,
    store: options.sessionStore ?? new MemoryStore<StoredSession>({ now }),
    sessionTtlMs: options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS,
    secret,
    now,
  });

  const cookieDefaults: CookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    maxAge: Math.floor((options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS) / 1000),
    ...options.cookie,
  };

  function createProxyFetch(sourceRequest: Request): typeof fetch {
    const sourceUrl = new URL(sourceRequest.url);
    const sourceCookie = sourceRequest.headers.get("cookie");
    const sourceOrigin = sourceRequest.headers.get("origin") ?? sourceUrl.origin;

    return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const proxied = await toProxyRequest(input, init, {
        baseUrl: sourceUrl,
        cookie: sourceCookie,
        origin: sourceOrigin,
      });
      return handler(proxied);
    }) as typeof fetch;
  }

  async function readSessionId(request: Request): Promise<string | undefined> {
    const signed = readCookie(request, cookieName);
    if (!signed) return undefined;
    return unsign(signed, secret);
  }

  async function issueSessionCookie(request: Request, sessionId: string): Promise<string> {
    const signed = await sign(sessionId, secret);
    const secure = cookieDefaults.secure ?? isSecureRequest(request);
    return serializeCookie(cookieName, signed, { ...cookieDefaults, secure });
  }

  function clearCookie(request: Request): string {
    const secure = cookieDefaults.secure ?? isSecureRequest(request);
    return serializeCookie(cookieName, "", { ...cookieDefaults, maxAge: 0, secure });
  }

  /**
   * Cookie-authenticated non-GET routes only accept browser requests from the
   * handler's own origin or `allowedOrigins`. This keeps third-party sites from
   * riding the session cookie (CSRF) even when it is set `SameSite=None` for a
   * cross-origin frontend. Requests without an `Origin` header (curl, server
   * code) pass. They cannot carry a victim's cookie.
   */
  function checkOrigin(request: Request): Response | undefined {
    const origin = request.headers.get("origin");
    if (!origin) return undefined;
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      return originNotAllowed(origin); // includes the opaque "null" origin
    }
    if (parsed.origin === getRequestOrigin(request)) return undefined;
    if (allowedOrigins.has(parsed.origin)) return undefined;
    return originNotAllowed(parsed.origin);
  }

  async function checkRateLimit(sessionId: string): Promise<Response | undefined> {
    if (!rateLimit) return undefined;
    const nowMs = now();
    const bucket = await rateLimit.store.get(sessionId);
    if (!bucket || bucket.resetAt <= nowMs) {
      await rateLimit.store.set(sessionId, { count: 1, resetAt: nowMs + rateLimit.windowMs }, { ttlMs: rateLimit.windowMs });
      return undefined;
    }
    if (bucket.count >= rateLimit.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - nowMs) / 1000));
      const headers = new Headers({ "retry-after": String(retryAfterSeconds) });
      return json({ error: "rate_limited", retryAfterSeconds }, { status: 429, headers });
    }
    bucket.count += 1;
    await rateLimit.store.set(sessionId, bucket, { ttlMs: bucket.resetAt - nowMs });
    return undefined;
  }

  async function handleLogin(request: Request): Promise<Response> {
    let sessionId = await readSessionId(request);
    const headers = new Headers();
    if (!sessionId) {
      sessionId = randomToken(24);
      headers.append("Set-Cookie", await issueSessionCookie(request, sessionId));
    }
    const { device } = await sessions.startDeviceLogin(sessionId);
    return json(
      {
        status: "pending" satisfies LoginStatus,
        userCode: device.userCode,
        verificationUrl: device.verificationUrl,
        interval: device.interval,
        expiresAt: device.expiresAt,
      },
      { headers },
    );
  }

  async function handleStatus(request: Request): Promise<Response> {
    const sessionId = await readSessionId(request);
    if (!sessionId) return json({ status: "unauthenticated" satisfies LoginStatus });
    const data = await sessions.advance(sessionId);
    return json(toPublic(data));
  }

  async function handleSession(request: Request): Promise<Response> {
    const sessionId = await readSessionId(request);
    if (!sessionId) return json({ status: "unauthenticated" satisfies LoginStatus });
    const data = await sessions.load(sessionId);
    return json(data ? toPublic(data) : { status: "unauthenticated" });
  }

  async function handleLogout(request: Request): Promise<Response> {
    const sessionId = await readSessionId(request);
    if (sessionId) await sessions.delete(sessionId);
    return json(
      { status: "unauthenticated" satisfies LoginStatus },
      { headers: new Headers({ "Set-Cookie": clearCookie(request) }) },
    );
  }

  async function handleModels(request: Request): Promise<Response> {
    try {
      const models = await getModelsForRequest(request);
      if (!models) {
        return json({ error: "not_authenticated" }, { status: 401 });
      }
      return json({ models });
    } catch (error) {
      if (error instanceof ChatGPTAuthError) {
        return json(
          { models: [], error: error.code, message: error.message, status: error.status },
          { status: error.status ?? 502 },
        );
      }
      throw error;
    }
  }

  async function getModelsForRequest(request: Request): Promise<string[] | undefined> {
    const sessionId = await readSessionId(request);
    const tokens = sessionId ? await sessions.getFreshTokens(sessionId) : undefined;
    if (!tokens?.accessToken || !tokens.accountId) {
      return undefined;
    }
    return listCodexModels({
      config,
      getAuth: () => ({ accessToken: tokens.accessToken, accountId: tokens.accountId as string }),
    });
  }

  async function handleResponses(request: Request): Promise<Response> {
    const sessionId = await readSessionId(request);
    if (!sessionId) return json({ error: "not_authenticated" }, { status: 401 });
    // Rate limit before touching tokens so throttled requests are cheap.
    const limited = await checkRateLimit(sessionId);
    if (limited) return limited;
    const tokens = await sessions.getFreshTokens(sessionId);
    if (!tokens?.accessToken || !tokens.accountId) {
      return json({ error: "not_authenticated" }, { status: 401 });
    }

    const codexFetch = createCodexFetch({
      config,
      instructions: options.instructions,
      reasoningEffort: options.reasoningEffort,
      reasoningSummary: options.reasoningSummary,
      textVerbosity: options.textVerbosity,
      serviceTier: options.serviceTier,
      getAuth: () => ({ accessToken: tokens.accessToken, accountId: tokens.accountId as string }),
    });

    const serviceTier = readServiceTierHeader(request);
    if (serviceTier instanceof Response) return serviceTier;
    const reasoningEffort = readReasoningEffortHeader(request);
    if (reasoningEffort instanceof Response) return reasoningEffort;

    const policyResult = await prepareResponsesPayload(request, {
      defaultModel,
      allowedModels: responsesProxy.allowedModels,
      maxRequestBytes: maxResponsesBodyBytes,
      serviceTier,
      reasoningEffort,
    });
    if (policyResult instanceof Response) return policyResult;

    try {
      const proxyResponses = (body: string) =>
        codexFetch(`${config.codexBaseUrl}/responses`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "text/event-stream" },
          body,
          signal: request.signal,
        });
      let upstream = await proxyResponses(policyResult);
      // Surface (and log) upstream errors instead of forwarding an empty/opaque
      // body, which the AI SDK reports only as a generic "No output" error.
      if (!upstream.ok) {
        let errorBody = await upstream.text();
        if (serviceTier === "fast" && isUnsupportedServiceTierError(errorBody)) {
          upstream = await proxyResponses(removeResponsesField(policyResult, "service_tier"));
          if (upstream.ok) {
            const headers = new Headers();
            headers.set("content-type", upstream.headers.get("content-type") ?? "text/event-stream");
            headers.set("cache-control", "no-store");
            headers.set("x-login-with-chatgpt-service-tier-fallback", "auto");
            return new Response(upstream.body, { status: upstream.status, headers });
          }
          errorBody = await upstream.text();
        }
        console.error(`[login-with-chatgpt] Codex /responses ${upstream.status}: ${errorBody.slice(0, 2000)}`);
        return json({ error: "responses_request_failed", status: upstream.status, detail: errorBody.slice(0, 2000) }, { status: upstream.status });
      }
      const headers = new Headers();
      headers.set("content-type", upstream.headers.get("content-type") ?? "text/event-stream");
      headers.set("cache-control", "no-store");
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch (error) {
      if (error instanceof ChatGPTAuthError) {
        return json({ error: error.code, message: error.message }, { status: 502 });
      }
      throw error;
    }
  }

  async function handleRealtime(request: Request): Promise<Response> {
    const sessionId = await readSessionId(request);
    if (!sessionId) return json({ error: "not_authenticated" }, { status: 401 });
    const payload = await prepareRealtimePayload(request, maxRealtimeBodyBytes);
    if (payload instanceof Response) return payload;
    const mergedSession = mergeRealtimeSessionOptions(realtime.sessionDefaults, payload.session) ?? {};
    const transport = mergedSession.transport ?? "wm";
    const mode = mergedSession.voiceMode ?? (transport === "wm" ? "wingman" : transport === "vps" ? "standard" : "advanced");
    if (realtime.allowedModes && !realtime.allowedModes.includes(mode)) {
      return json({ error: "realtime_mode_not_allowed", voiceMode: mode }, { status: 403 });
    }

    try {
      let realtimeAuth: ChatGPTRealtimeAuth;
      if (realtime.getAuth) {
        realtimeAuth = await realtime.getAuth({ request, sessionId, transport });
      } else {
        if (transport === "wm") {
          return json(
            {
              error: "realtime_web_auth_required",
              message: "GPT Live `/wm` requires realtime.getAuth backed by a server-side ChatGPT web session.",
            },
            { status: 501 },
          );
        }
        const tokens = await sessions.getFreshTokens(sessionId);
        if (!tokens?.accessToken || !tokens.accountId) {
          return json({ error: "not_authenticated" }, { status: 401 });
        }
        realtimeAuth = { accessToken: tokens.accessToken, accountId: tokens.accountId };
      }

      const answer = await createChatGPTRealtimeCall({
        config,
        getAuth: () => realtimeAuth,
        sdp: payload.sdp,
        session: mergedSession,
        signal: request.signal,
      });
      return new Response(answer, {
        status: 201,
        headers: { "content-type": "application/sdp", "cache-control": "no-store" },
      });
    } catch (error) {
      if (error instanceof TypeError) {
        return json({ error: "invalid_realtime_request", message: error.message }, { status: 400 });
      }
      if (error instanceof ChatGPTAuthError) {
        return json(
          { error: error.code, message: error.message, status: error.status, detail: error.body?.slice(0, 2000) },
          { status: error.status ?? 502 },
        );
      }
      throw error;
    }
  }

  const routes: Record<string, Partial<Record<string, (request: Request) => Promise<Response>>>> = {
    "/login": { POST: handleLogin },
    "/status": { GET: handleStatus },
    "/session": { GET: handleSession },
    "/logout": { POST: handleLogout },
    ...(enableRealtime ? { "/realtime": { POST: handleRealtime } } : {}),
    ...(enableResponsesProxy ? { "/responses": { POST: handleResponses }, "/models": { GET: handleModels } } : {}),
  };

  const handler = async (request: Request): Promise<Response> => {
    const route = matchRoute(new URL(request.url).pathname, basePath);
    const methods = route === undefined ? undefined : routes[route];
    if (!methods) return new Response("Not found", { status: 404 });
    const method = methods[request.method];
    if (!method) {
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: Object.keys(methods).join(", ") },
      });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      const blocked = checkOrigin(request);
      if (blocked) return blocked;
    }
    return method(request);
  };

  async function dangerouslyGetTokens(
    request: Request,
    tokenOptions?: GetTokensOptions,
  ): Promise<ChatGPTTokens | undefined> {
    if (!options.dangerouslyAllowTokenExport) {
      throw new ChatGPTAuthError(
        "token_export_disabled",
        "`dangerouslyGetTokens()` is disabled by default because ChatGPT bearer tokens are usable outside the proxy. Use `/responses`, `/models`, or `proxyFetch(request)`, or set `dangerouslyAllowTokenExport: true` if you accept that server-side trust boundary.",
        { status: 403 },
      );
    }
    if (tokenOptions?.includeRefreshToken && !options.dangerouslyAllowRefreshTokenExport) {
      throw new ChatGPTAuthError(
        "refresh_token_export_disabled",
        "Refresh-token export is disabled. Set `dangerouslyAllowRefreshTokenExport: true` only for deliberate migration/export flows.",
        { status: 403 },
      );
    }
    const sessionId = await readSessionId(request);
    const tokens = sessionId ? await sessions.getFreshTokens(sessionId) : undefined;
    if (!tokens || tokenOptions?.includeRefreshToken) return tokens;
    const { refreshToken: _redacted, ...safe } = tokens;
    return safe;
  }

  return {
    basePath,
    handler,
    fetch: handler,
    proxyFetch: createProxyFetch,
    getSession: async (request) => {
      const sessionId = await readSessionId(request);
      if (!sessionId) return { status: "unauthenticated" };
      const data = await sessions.load(sessionId);
      return data ? toPublic(data) : { status: "unauthenticated" };
    },
    getTokens: dangerouslyGetTokens,
    dangerouslyGetTokens,
    getModels: getModelsForRequest,
  };
}

async function toProxyRequest(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  options: {
    baseUrl: URL;
    cookie: string | null;
    origin: string;
  },
): Promise<Request> {
  const inputRequest = input instanceof Request ? input : undefined;
  const inputUrl =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : inputRequest ? inputRequest.url : String(input);
  const url = new URL(inputUrl, options.baseUrl.origin);
  const method = init?.method ?? inputRequest?.method ?? "GET";
  const headers = new Headers(inputRequest?.headers);
  if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  if (options.cookie) headers.set("cookie", options.cookie);
  if (!headers.has("origin")) headers.set("origin", options.origin);

  let body: BodyInit | undefined;
  if (method !== "GET" && method !== "HEAD") {
    body = init?.body ?? (inputRequest && inputRequest.body ? await inputRequest.clone().text() : undefined);
  }

  return new Request(url.toString(), {
    method,
    headers,
    body,
    signal: init?.signal ?? inputRequest?.signal,
  });
}

function toPublic(data: { status: LoginStatus; user?: ChatGPTUser }): PublicSession {
  return data.user ? { status: data.status, user: data.user } : { status: data.status };
}

function normalizeBasePath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** Returns the sub-route (e.g. `/login`) when `pathname` is under `basePath`. */
function matchRoute(pathname: string, basePath: string): string | undefined {
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`)) return pathname.slice(basePath.length);
  return undefined;
}

async function prepareResponsesPayload(
  request: Request,
  options: {
    defaultModel: string;
    allowedModels?: ResponsesProxyPolicy["allowedModels"];
    maxRequestBytes: number;
    serviceTier?: CodexServiceTier;
    reasoningEffort?: ReasoningEffort;
  },
): Promise<string | Response> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > options.maxRequestBytes) {
    return json(
      { error: "responses_request_too_large", maxRequestBytes: options.maxRequestBytes },
      { status: 413 },
    );
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > options.maxRequestBytes) {
    return json(
      { error: "responses_request_too_large", maxRequestBytes: options.maxRequestBytes },
      { status: 413 },
    );
  }

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ error: "invalid_responses_request", message: "Expected a JSON object body." }, { status: 400 });
    }
    if (parsed.model === undefined) parsed.model = options.defaultModel;
    if (typeof parsed.model !== "string" || parsed.model.length === 0) {
      return json({ error: "invalid_responses_request", message: "`model` must be a string." }, { status: 400 });
    }
    if (!isModelAllowed(parsed.model, options.allowedModels)) {
      return json({ error: "model_not_allowed", model: parsed.model }, { status: 403 });
    }
    if (options.serviceTier) parsed.service_tier = options.serviceTier;
    if (options.reasoningEffort) {
      parsed.reasoning = {
        ...(isRecord(parsed.reasoning) ? parsed.reasoning : {}),
        effort: options.reasoningEffort,
      };
    }
    return JSON.stringify(parsed);
  } catch {
    return json({ error: "invalid_responses_request", message: "Expected a JSON object body." }, { status: 400 });
  }
}

function readServiceTierHeader(request: Request): CodexServiceTier | Response | undefined {
  const value = request.headers.get(SERVICE_TIER_HEADER);
  if (!value) return undefined;
  const tier = value.trim().toLowerCase();
  if (SERVICE_TIERS.has(tier as CodexServiceTier)) return tier as CodexServiceTier;
  return json({ error: "invalid_service_tier", serviceTier: value }, { status: 400 });
}

function readReasoningEffortHeader(request: Request): ReasoningEffort | Response | undefined {
  const value = request.headers.get(REASONING_EFFORT_HEADER);
  if (!value) return undefined;
  const effort = value.trim().toLowerCase();
  if (REASONING_EFFORTS.has(effort as ReasoningEffort)) return effort as ReasoningEffort;
  return json({ error: "invalid_reasoning_effort", reasoningEffort: value }, { status: 400 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnsupportedServiceTierError(body: string): boolean {
  return body.toLowerCase().includes("unsupported service_tier");
}

function removeResponsesField(body: string, field: string): string {
  try {
    const parsed = JSON.parse(body);
    if (!isRecord(parsed)) return body;
    delete parsed[field];
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

function isModelAllowed(model: string, allowedModels: ResponsesProxyPolicy["allowedModels"]): boolean {
  if (!allowedModels) return true;
  if (typeof allowedModels === "function") return allowedModels(model);
  return allowedModels.includes(model);
}

async function prepareRealtimePayload(
  request: Request,
  maxRequestBytes: number,
): Promise<{ sdp: string; session?: ChatGPTRealtimeSessionOptions } | Response> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxRequestBytes) {
    return json({ error: "realtime_request_too_large", maxRequestBytes }, { status: 413 });
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxRequestBytes) {
    return json({ error: "realtime_request_too_large", maxRequestBytes }, { status: 413 });
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed) || typeof parsed["sdp"] !== "string" || !parsed["sdp"].trim()) {
      return json(
        { error: "invalid_realtime_request", message: "Expected a non-empty `sdp` string." },
        { status: 400 },
      );
    }
    const rawSession = parsed["session"];
    if (rawSession !== undefined && !isRecord(rawSession)) {
      return json(
        { error: "invalid_realtime_request", message: "`session` must be a JSON object." },
        { status: 400 },
      );
    }
    const mode = rawSession?.["voiceMode"];
    if (mode !== undefined && mode !== "advanced" && mode !== "standard") {
      return json(
        { error: "invalid_realtime_request", message: "`session.voiceMode` must be `advanced` or `standard`." },
        { status: 400 },
      );
    }
    return {
      sdp: parsed["sdp"],
      session: rawSession as ChatGPTRealtimeSessionOptions | undefined,
    };
  } catch {
    return json({ error: "invalid_realtime_request", message: "Expected a JSON object body." }, { status: 400 });
  }
}

function mergeRealtimeSessionOptions(
  defaults?: ChatGPTRealtimeSessionOptions,
  requested?: ChatGPTRealtimeSessionOptions,
): ChatGPTRealtimeSessionOptions | undefined {
  if (!defaults) return requested;
  if (!requested) return defaults;
  return {
    ...defaults,
    ...requested,
    extra: { ...(defaults.extra ?? {}), ...(requested.extra ?? {}) },
  };
}

function originNotAllowed(origin: string): Response {
  return json(
    {
      error: "origin_not_allowed",
      origin,
      message: "Cross-origin request rejected. Add your frontend's origin to `allowedOrigins` if this is intentional.",
    },
    { status: 403 },
  );
}

/** `true` when the client connection is HTTPS, including behind a TLS-terminating proxy. */
function isSecureRequest(request: Request): boolean {
  return (forwardedProtocol(request) ?? new URL(request.url).protocol) === "https:";
}

function getRequestOrigin(request: Request): string {
  const url = new URL(request.url);
  return `${forwardedProtocol(request) ?? url.protocol}//${url.host}`;
}

function forwardedProtocol(request: Request): "http:" | "https:" | undefined {
  const value = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (value === "http" || value === "https") return `${value}:`;
  return undefined;
}

function json(data: unknown, init: { status?: number; headers?: Headers } = {}): Response {
  const headers = init.headers ?? new Headers();
  headers.set("content-type", "application/json");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { status: init.status ?? 200, headers });
}

let warnedAboutSecret = false;
function createEphemeralSecret(): string {
  if (!warnedAboutSecret) {
    warnedAboutSecret = true;
    console.warn(
      "[login-with-chatgpt] No `secret` provided. Using an ephemeral one. Sessions won't survive restarts or span instances. Set `secret` in production.",
    );
  }
  return randomToken(32);
}
