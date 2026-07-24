import type { FetchLike } from "./types.ts";
import {
  connectChatGPTRealtime,
  type ChatGPTRealtimeConnection,
  type ConnectChatGPTRealtimeOptions,
} from "./realtime-browser.ts";

export type ChatGPTRealtimeAppServerEvent =
  | { type: "session.started" }
  | { type: "session.closed" }
  | { type: "handoff"; transcript: string }
  | { type: "tool.running"; callId: string; name: string }
  | { type: "tool.completed"; callId: string; name: string }
  | {
      type: "tool.pending_confirmation";
      callId: string;
      name: string;
      review: unknown;
    }
  | { type: "tool.failed"; callId?: string; name?: string; message: string }
  | { type: "error"; message: string }
  | { type: "keepalive" };

export interface ConnectChatGPTRealtimeAppServerOptions
  extends Omit<ConnectChatGPTRealtimeOptions, "endpoint"> {
  /**
   * Cookie-authenticated app-server route. Defaults to
   * `/api/chatgpt/realtime/app-server`.
   */
  endpoint?: string;
  onBridgeEvent?: (event: ChatGPTRealtimeAppServerEvent) => void;
}

export interface ChatGPTRealtimeAppServerConnection extends ChatGPTRealtimeConnection {
  /** Opaque server-side Live session id. */
  sessionId: string;
  /**
   * Resolves an application-owned pending action. The confirmation payload is
   * intentionally application-defined and must be authorized server-side.
   */
  resolveConfirmation(callId: string, confirmation: unknown): Promise<void>;
  /** Closes the server-side app-server process and waits for acknowledgement. */
  closeServer(): Promise<void>;
}

/**
 * Opens native GPT Live WebRTC audio through the SDK's desktop-style
 * app-server route, subscribes to tool lifecycle events, and exposes explicit
 * confirmation and cleanup controls.
 */
export async function connectChatGPTRealtimeAppServer(
  options: ConnectChatGPTRealtimeAppServerOptions = {},
): Promise<ChatGPTRealtimeAppServerConnection> {
  const {
    endpoint: requestedEndpoint,
    onBridgeEvent,
    ...realtimeOptions
  } = options;
  const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) throw new TypeError("No fetch implementation available.");
  const endpoint = (requestedEndpoint ?? "/api/chatgpt/realtime/app-server").replace(/\/+$/, "");
  let sessionId = "";

  const signalingFetch = (async (
    input: Parameters<FetchLike>[0],
    init?: Parameters<FetchLike>[1],
  ) => {
    const response = await fetchImpl(input, init);
    const text = await response.text();
    if (!response.ok) {
      return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("Realtime app-server signaling returned invalid JSON.");
    }
    if (!isRecord(payload) || typeof payload["sessionId"] !== "string" ||
        typeof payload["sdp"] !== "string" || !payload["sdp"].trim()) {
      throw new Error("Realtime app-server signaling returned an invalid session.");
    }
    sessionId = payload["sessionId"];
    return new Response(payload["sdp"], {
      status: response.status,
      headers: {
        "content-type": "application/sdp",
        "cache-control": "no-store",
      },
    });
  }) as FetchLike;

  let connection: ChatGPTRealtimeConnection;
  try {
    connection = await connectChatGPTRealtime({
      ...realtimeOptions,
      endpoint,
      fetch: signalingFetch,
    });
  } catch (cause) {
    if (sessionId) {
      await fetchImpl(`${endpoint}/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
        credentials: "include",
        headers: { accept: "application/json" },
      }).catch(() => {});
    }
    throw cause;
  }
  if (!sessionId) {
    connection.close();
    throw new Error("Realtime app-server signaling returned no session id.");
  }

  const encodedSessionId = encodeURIComponent(sessionId);
  const eventsAbort = new AbortController();
  let serverClosed = false;
  let closePromise: Promise<void> | undefined;
  const report = (cause: unknown) => {
    if (isExpectedStreamCancellation(cause)) return;
    options.onError?.(cause instanceof Error ? cause : new Error(String(cause)));
  };
  if (options.signal) {
    const abort = () => eventsAbort.abort(options.signal?.reason);
    options.signal.addEventListener("abort", abort, { once: true });
  }

  void streamAppServerEvents(
    fetchImpl,
    `${endpoint}/${encodedSessionId}/events`,
    eventsAbort.signal,
    (event) => {
      try {
        onBridgeEvent?.(event);
      } catch (cause) {
        report(cause);
      }
      if (event.type === "error") report(new Error(event.message));
    },
  ).catch(report);

  const closeServer = () => {
    if (closePromise) return closePromise;
    serverClosed = true;
    eventsAbort.abort();
    closePromise = fetchImpl(`${endpoint}/${encodedSessionId}`, {
      method: "DELETE",
      credentials: "include",
      headers: { accept: "application/json" },
    }).then(async (response) => {
      if (response.ok || response.status === 404) return;
      throw new Error(
        `Realtime app-server cleanup failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
      );
    });
    return closePromise;
  };

  const closeConnection = connection.close;
  return Object.assign(connection, {
    sessionId,
    resolveConfirmation: async (callId: string, confirmation: unknown) => {
      const response = await fetchImpl(`${endpoint}/${encodedSessionId}/confirm`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ callId, confirmation }),
      });
      if (response.ok) return;
      throw new Error(
        `Realtime confirmation failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
      );
    },
    closeServer,
    close: () => {
      closeConnection();
      if (!serverClosed) void closeServer().catch(report);
    },
  });
}

export function parseChatGPTRealtimeAppServerEvent(
  value: unknown,
): ChatGPTRealtimeAppServerEvent | undefined {
  if (!isRecord(value) || typeof value["type"] !== "string") return undefined;
  switch (value["type"]) {
    case "session.started":
    case "session.closed":
    case "keepalive":
      return value as ChatGPTRealtimeAppServerEvent;
    case "handoff":
      return typeof value["transcript"] === "string"
        ? value as ChatGPTRealtimeAppServerEvent
        : undefined;
    case "tool.running":
    case "tool.completed":
      return typeof value["callId"] === "string" && typeof value["name"] === "string"
        ? value as ChatGPTRealtimeAppServerEvent
        : undefined;
    case "tool.pending_confirmation":
      return typeof value["callId"] === "string" && typeof value["name"] === "string"
        && "review" in value
        ? value as ChatGPTRealtimeAppServerEvent
        : undefined;
    case "tool.failed":
      return typeof value["message"] === "string"
        && (value["callId"] === undefined || typeof value["callId"] === "string")
        && (value["name"] === undefined || typeof value["name"] === "string")
        ? value as ChatGPTRealtimeAppServerEvent
        : undefined;
    case "error":
      return typeof value["message"] === "string"
        ? value as ChatGPTRealtimeAppServerEvent
        : undefined;
    default:
      return undefined;
  }
}

async function streamAppServerEvents(
  fetchImpl: FetchLike,
  url: string,
  signal: AbortSignal,
  onEvent: (event: ChatGPTRealtimeAppServerEvent) => void,
): Promise<void> {
  const response = await fetchImpl(url, {
    method: "GET",
    credentials: "include",
    headers: { accept: "application/x-ndjson" },
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(
      `Realtime app-server event stream failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          try {
            const event = parseChatGPTRealtimeAppServerEvent(JSON.parse(line));
            if (event) onEvent(event);
          } catch {
            // Ignore malformed status lines without interrupting native audio.
          }
        }
        newline = buffer.indexOf("\n");
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

function isExpectedStreamCancellation(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message.toLowerCase() : String(cause).toLowerCase();
  return (
    (cause instanceof DOMException && cause.name === "AbortError")
    || message.includes("aborted")
    || message.includes("body stream buffer")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
