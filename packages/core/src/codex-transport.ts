import type { ResolvedConfig } from "./config.ts";
import { DEFAULT_CODEX_INSTRUCTIONS, REASONING_ENCRYPTED_CONTENT } from "./constants.ts";
import { ChatGPTAuthError } from "./errors.ts";
import type { FetchLike } from "./types.ts";

/** Auth material required to call the Codex responses API. */
export interface CodexAuth {
  accessToken: string;
  accountId: string;
}

/** Reasoning effort levels accepted by the Codex backend. */
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

/** Service tiers accepted by Codex-style responses requests. */
export type CodexServiceTier = "auto" | "default" | "flex" | "priority" | "fast";

export interface CodexResponsesOptions {
  /** System instructions sent with every `/responses` call. */
  instructions?: string;
  /** Reasoning effort. Defaults to `medium`. */
  reasoningEffort?: ReasoningEffort;
  /** Reasoning summary mode. Defaults to `auto`. */
  reasoningSummary?: string;
  /** Text verbosity. Defaults to `medium`. */
  textVerbosity?: "low" | "medium" | "high";
  /**
   * Default service tier for `/responses`. Codex's ChatGPT path supports
   * `fast` for eligible GPT-5.5/GPT-5.4 sessions; API-key OpenAI provider
   * types usually expose only `auto`, `default`, `flex`, and `priority`.
   */
  serviceTier?: CodexServiceTier;
}

export interface CodexFetchOptions extends CodexResponsesOptions {
  config: ResolvedConfig;
  /**
   * Supplies fresh auth for each request. Wire this to your session/token store
   * plus `ensureFreshTokens` so tokens are refreshed transparently.
   */
  getAuth: () => Promise<CodexAuth> | CodexAuth;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
}

export interface ListCodexModelsOptions {
  config: ResolvedConfig;
  /**
   * Supplies fresh auth for the models request. Wire this to the same session
   * token refresh path used for responses.
   */
  getAuth: () => Promise<CodexAuth> | CodexAuth;
  /** Extra headers merged into the request. */
  headers?: Record<string, string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Adapts a standard OpenAI responses payload for the ChatGPT-backed Codex
 * endpoint. The backend runs **stateless** (`store: false`), which imposes
 * several non-obvious requirements — omitting any of them yields a stream with
 * no assistant text (`AI_NoOutputGeneratedError`):
 *
 * - `reasoning` must be configured (Codex models always reason).
 * - `include` must request `reasoning.encrypted_content` so reasoning can be
 *   carried across turns without server-side storage.
 * - input items must not carry server-side ids, and `item_reference` items
 *   (an AI SDK construct) must be removed.
 * - `max_output_tokens` / `max_completion_tokens` are rejected.
 *
 * Caller-provided values win over the defaults.
 */
export function normalizeResponsesBody(
  body: Record<string, unknown>,
  options: CodexResponsesOptions = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };

  if (typeof out["instructions"] !== "string") {
    out["instructions"] = options.instructions ?? DEFAULT_CODEX_INSTRUCTIONS;
  }

  // The ChatGPT backend requires stateless operation.
  out["store"] = false;

  // Reasoning is required; keep any caller-provided fields on top of defaults.
  out["reasoning"] = {
    effort: options.reasoningEffort ?? "medium",
    summary: options.reasoningSummary ?? "auto",
    ...(isRecord(out["reasoning"]) ? out["reasoning"] : {}),
  };

  out["text"] = {
    verbosity: options.textVerbosity ?? "medium",
    ...(isRecord(out["text"]) ? out["text"] : {}),
  };

  if (typeof out["service_tier"] !== "string" && options.serviceTier) {
    out["service_tier"] = options.serviceTier;
  }

  // Ensure encrypted reasoning content is included.
  const include = new Set<string>(
    Array.isArray(out["include"]) ? out["include"].filter((v): v is string => typeof v === "string") : [],
  );
  include.add(REASONING_ENCRYPTED_CONTENT);
  out["include"] = [...include];

  if (Array.isArray(out["input"])) {
    out["input"] = filterCodexInput(out["input"]);
  }

  delete out["max_output_tokens"];
  delete out["max_completion_tokens"];
  return out;
}

/**
 * Strips server-side ids from input items and removes `item_reference` entries,
 * which the stateless Codex API does not accept.
 */
export function filterCodexInput(input: unknown[]): unknown[] {
  return input
    .filter((item) => !(isRecord(item) && item["type"] === "item_reference"))
    .map((item) => {
      if (isRecord(item) && "id" in item) {
        const { id, ...rest } = item;
        return rest;
      }
      return item;
    });
}

/**
 * Builds a `fetch` that authenticates and adapts requests for the ChatGPT-backed
 * Codex responses API. Pass it to the AI SDK's OpenAI provider or call it
 * directly from a proxy handler.
 */
export function createCodexFetch(options: CodexFetchOptions): FetchLike {
  const { config } = options;
  const baseFetch = config.fetch;

  const codexFetch = (async (input: Parameters<FetchLike>[0], init?: Parameters<FetchLike>[1]) => {
    const request = await readRequest(input, init);
    const targetUrl = withClientVersion(resolveTargetUrl(request.url, config.codexBaseUrl), config.clientVersion);

    const auth = await options.getAuth();
    const headers = new Headers(options.headers);
    request.headers.forEach((value, key) => headers.set(key, value));
    headers.set("Authorization", `Bearer ${auth.accessToken}`);
    headers.set("chatgpt-account-id", auth.accountId);
    headers.set("OpenAI-Beta", "responses=experimental");
    headers.set("originator", config.originator);

    const body = await maybeNormalizeBody(targetUrl, headers, request.body, options);

    return baseFetch(targetUrl, {
      method: request.method,
      headers,
      body,
      signal: request.signal ?? undefined,
    });
  }) as FetchLike;

  return codexFetch;
}

/** Fetches the signed-in ChatGPT account's currently available Codex model slugs. */
export async function listCodexModels(options: ListCodexModelsOptions): Promise<string[]> {
  const codexFetch = createCodexFetch({
    config: options.config,
    getAuth: options.getAuth,
    headers: options.headers,
  });

  const response = await codexFetch(`${options.config.codexBaseUrl}/models`, {
    method: "GET",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new ChatGPTAuthError("models_request_failed", `Model list request failed (${response.status}).`, {
      status: response.status,
      body: await safeText(response),
    });
  }

  return extractCodexModelSlugs(await response.json());
}

/**
 * Extracts model slugs from the shapes the ChatGPT backend has used for model
 * lists. Unknown entries are ignored so SDK callers can rely on a clean string
 * array while the raw endpoint remains undocumented.
 */
export function extractCodexModelSlugs(value: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const visit = (item: unknown) => {
    const candidate = typeof item === "string"
      ? item
      : isRecord(item)
        ? item["slug"] ?? item["id"] ?? item["model"] ?? item["name"]
        : undefined;
    if (typeof candidate !== "string") return;
    const slug = candidate.trim();
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    out.push(slug);
  };

  const candidateLists = Array.isArray(value)
    ? [value]
    : isRecord(value)
      ? [value["models"], value["data"], value["items"], value["available_models"]].filter(Array.isArray)
      : [];

  for (const candidates of candidateLists) {
    for (const item of candidates) visit(item);
  }

  return out;
}

interface RequestParts {
  url: string;
  method: string;
  headers: Headers;
  body: BodyInit | null | undefined;
  signal: AbortSignal | null | undefined;
}

async function readRequest(
  input: Parameters<FetchLike>[0],
  init: Parameters<FetchLike>[1],
): Promise<RequestParts> {
  if (input instanceof Request) {
    const headers = new Headers(input.headers);
    if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    return {
      url: input.url,
      method: init?.method ?? input.method,
      headers,
      body: init?.body ?? (input.body == null ? undefined : await input.clone().text()),
      signal: init?.signal ?? input.signal,
    };
  }
  return {
    url: typeof input === "string" ? input : input.toString(),
    method: init?.method ?? "GET",
    headers: new Headers(init?.headers),
    body: init?.body,
    signal: init?.signal,
  };
}

/**
 * Maps an incoming URL onto the Codex base URL, tolerating both absolute URLs
 * (from the AI SDK) and bare paths (from a proxy), and stripping a redundant
 * `/v1` segment that the OpenAI provider may add.
 */
export function resolveTargetUrl(input: string, codexBaseUrl: string): string {
  const base = new URL(codexBaseUrl);
  const basePath = base.pathname.replace(/\/+$/, "");
  const parsed = /^https?:\/\//.test(input) ? new URL(input) : new URL(input, "https://placeholder.invalid");

  let pathname = parsed.pathname;
  if (basePath && pathname.startsWith(`${basePath}/`)) pathname = pathname.slice(basePath.length);
  if (pathname === "/v1") pathname = "/";
  else if (pathname.startsWith("/v1/")) pathname = pathname.slice(3);
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;

  return `${base.origin}${basePath}${pathname}${parsed.search}`;
}

/** Ensures the `client_version` query param is present (the model gate depends on it). */
export function withClientVersion(targetUrl: string, clientVersion: string): string {
  if (!clientVersion) return targetUrl;
  const url = new URL(targetUrl);
  if (!url.searchParams.has("client_version")) {
    url.searchParams.set("client_version", clientVersion);
  }
  return url.toString();
}

async function maybeNormalizeBody(
  targetUrl: string,
  headers: Headers,
  body: BodyInit | null | undefined,
  options: CodexResponsesOptions,
): Promise<BodyInit | null | undefined> {
  if (!new URL(targetUrl).pathname.endsWith("/responses")) return body;
  const contentType = headers.get("content-type");
  if (contentType && !contentType.includes("application/json")) return body;

  const text = await decodeBody(body);
  if (typeof text !== "string") return body;

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return body;
    return JSON.stringify(normalizeResponsesBody(parsed as Record<string, unknown>, options));
  } catch {
    return body;
  }
}

async function decodeBody(body: BodyInit | null | undefined): Promise<string | undefined> {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams || body instanceof FormData || body instanceof ReadableStream) return undefined;
  if (body instanceof Blob) return body.text();
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body as ArrayBufferView);
  return undefined;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
