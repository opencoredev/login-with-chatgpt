import type { ResolvedConfig } from "./config.ts";
import { ChatGPTAuthError } from "./errors.ts";

export type ChatGPTRealtimeVoiceMode = "advanced" | "standard";
export type ChatGPTRealtimeState =
  | "connecting"
  | "idle"
  | "connected"
  | "halted"
  | "listening"
  | "listening_intently"
  | "thinking"
  | "speaking";

export type ChatGPTRealtimeAction =
  | "start_listening"
  | "stop_listening"
  | "stop_speaking"
  | "resume_listening"
  | "relay_message";

export interface ChatGPTRealtimeClientTool {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ChatGPTRealtimeSessionOptions {
  voice?: string;
  voiceMode?: ChatGPTRealtimeVoiceMode;
  model?: string;
  advancedModel?: string;
  language?: string | null;
  conversationId?: string | null;
  parentMessageId?: string;
  timezone?: string;
  timezoneOffsetMinutes?: number;
  clientTools?: ChatGPTRealtimeClientTool[];
  conversationMode?: Record<string, unknown>;
  historyAndTrainingDisabled?: boolean;
  enableMessageStreaming?: boolean;
  modelSpeaksFirst?: boolean;
  reasoningEffort?: string;
  thinkingEffort?: string;
  chatRequestToken?: string;
  bidiSystemPromptOverride?: Record<string, unknown>;
  structuredSystemPromptPersonalityOverride?: Record<string, unknown>;
  delegationTransportOverride?: Record<string, unknown>;
  jobsMockInterviewConfig?: Record<string, unknown>;
  systemPromptType?: string;
  /** Forward-compatible fields merged into the upstream session object. */
  extra?: Record<string, unknown>;
}

/** The multipart `session` object accepted by ChatGPT's web Realtime edge. */
export interface ChatGPTRealtimeSession {
  conversation_id: string | null;
  language_code: string | null;
  requested_default_model: string;
  voice: string;
  voice_session_id: string;
  voice_status_request_id: string;
  timezone_offset_min: number;
  timezone: string;
  voice_mode: ChatGPTRealtimeVoiceMode;
  model_slug: string;
  model_slug_advanced?: string;
  client_tools: ChatGPTRealtimeClientTool[];
  history_and_training_disabled: boolean;
  conversation_mode: Record<string, unknown>;
  enable_message_streaming: boolean;
  [key: string]: unknown;
}

export interface ChatGPTRealtimeAuth {
  accessToken: string;
  accountId: string;
}

export interface CreateChatGPTRealtimeCallOptions {
  config: ResolvedConfig;
  getAuth: () => Promise<ChatGPTRealtimeAuth> | ChatGPTRealtimeAuth;
  /** Browser-generated WebRTC offer SDP. */
  sdp: string;
  session?: ChatGPTRealtimeSessionOptions;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface ChatGPTRealtimeEvent {
  type: string;
  [key: string]: unknown;
}

export interface ChatGPTRealtimeStateEvent extends ChatGPTRealtimeEvent {
  type: "state_update";
  new_state?: ChatGPTRealtimeState;
  payload?: { new_state?: ChatGPTRealtimeState; [key: string]: unknown };
}

export interface ChatGPTRealtimeActionEvent extends ChatGPTRealtimeEvent {
  type: "action_request";
  payload: { action: ChatGPTRealtimeAction | string; [key: string]: unknown };
}

export interface ChatGPTRealtimeTranscriptionEvent extends ChatGPTRealtimeEvent {
  type: "user_transcription_text" | "live_captioning_text";
  text?: string;
  transcript?: string;
}

export interface ChatGPTRealtimeToolInvokeEvent extends ChatGPTRealtimeEvent {
  type: "client_tool_invoke";
  name?: string;
  call_id?: string;
  arguments?: unknown;
  payload?: Record<string, unknown>;
}

export interface ChatGPTRealtimeToolResultEvent extends ChatGPTRealtimeEvent {
  type: "client_tool_result" | "client_tool_update";
  call_id?: string;
  result?: unknown;
}

/** Known event names observed on ChatGPT's Realtime data channel. */
export const CHATGPT_REALTIME_EVENT_TYPES = [
  "state_update", "action_request", "goodbye", "conversation_update",
  "streaming_message_update", "close_request", "close_ready", "relay_message",
  "unknown", "usage_update", "tool_update", "spawn_update", "wingman_session_debug",
  "relay_message_processed", "turn_context", "performance", "startup_telemetry",
  "client_metrics", "client_metadata_update", "track_state", "full_chat_message",
  "chat_message_delta", "moderation", "url_moderation", "bio_safety_review_update",
  "live_captioning_text", "speaking_update", "user_transcription_text",
  "update_settings_request", "update_settings_result", "get_bidi_system_prompt",
  "bidi_system_prompt", "client_tool_invoke", "client_tool_result", "client_tool_update",
] as const;

export const CHATGPT_REALTIME_PATHS: Record<ChatGPTRealtimeVoiceMode, string> = {
  advanced: "/realtime/vp",
  standard: "/realtime/vps",
};

/** Builds a complete upstream session while keeping undocumented fields overridable. */
export function buildChatGPTRealtimeSession(
  options: ChatGPTRealtimeSessionOptions = {},
): ChatGPTRealtimeSession {
  if (options.voiceMode !== undefined && options.voiceMode !== "advanced" && options.voiceMode !== "standard") {
    throw new TypeError("`voiceMode` must be `advanced` or `standard`.");
  }
  const voice = options.voice ?? "juniper";
  const model = options.model ?? "gpt-4o";
  if (!voice.trim() || voice.length > 64) throw new TypeError("`voice` must be a non-empty string of at most 64 characters.");
  if (!model.trim() || model.length > 128) throw new TypeError("`model` must be a non-empty string of at most 128 characters.");
  if (options.clientTools !== undefined && !Array.isArray(options.clientTools)) {
    throw new TypeError("`clientTools` must be an array.");
  }
  if (options.timezoneOffsetMinutes !== undefined &&
      (!Number.isInteger(options.timezoneOffsetMinutes) || Math.abs(options.timezoneOffsetMinutes) > 24 * 60)) {
    throw new TypeError("`timezoneOffsetMinutes` must be an integer between -1440 and 1440.");
  }
  const id = createUuid();
  const voiceMode = options.voiceMode ?? "advanced";
  const session: ChatGPTRealtimeSession = {
    ...(options.extra ?? {}),
    conversation_id: options.conversationId ?? null,
    language_code: options.language ?? null,
    requested_default_model: model,
    voice,
    voice_session_id: id,
    voice_status_request_id: id,
    timezone_offset_min: options.timezoneOffsetMinutes ?? 0,
    timezone: options.timezone ?? "UTC",
    voice_mode: voiceMode,
    model_slug: model,
    client_tools: options.clientTools ?? [],
    history_and_training_disabled: options.historyAndTrainingDisabled ?? true,
    conversation_mode: options.conversationMode ?? { kind: "primary_assistant" },
    enable_message_streaming: options.enableMessageStreaming ?? true,
  };

  if (voiceMode === "advanced") session.model_slug_advanced = options.advancedModel ?? model;
  assignDefined(session, "parent_message_id", options.parentMessageId);
  assignDefined(session, "model_speaks_first", options.modelSpeaksFirst);
  assignDefined(session, "backend_reasoning_effort", options.reasoningEffort);
  assignDefined(session, "thinking_effort", options.thinkingEffort);
  assignDefined(session, "chatreq_token", options.chatRequestToken);
  assignDefined(session, "bidi_system_prompt_override", options.bidiSystemPromptOverride);
  assignDefined(session, "structured_system_prompt_personality_override", options.structuredSystemPromptPersonalityOverride);
  assignDefined(session, "delegation_transport_override", options.delegationTransportOverride);
  assignDefined(session, "jobs_mock_interview_config", options.jobsMockInterviewConfig);
  assignDefined(session, "system_prompt_type", options.systemPromptType);
  return session;
}

/**
 * Exchanges an SDP offer for an answer through the signed-in user's ChatGPT
 * subscription. This function belongs on the server; never pass its auth into
 * browser code.
 */
export async function createChatGPTRealtimeCall(
  options: CreateChatGPTRealtimeCallOptions,
): Promise<string> {
  if (!options.sdp.trim()) throw new TypeError("`sdp` must be a non-empty WebRTC offer.");
  const session = buildChatGPTRealtimeSession(options.session);
  const path = CHATGPT_REALTIME_PATHS[session.voice_mode];
  const auth = await options.getAuth();
  const form = new FormData();
  form.set("sdp", options.sdp);
  form.set("session", JSON.stringify(session));

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${auth.accessToken}`);
  headers.set("chatgpt-account-id", auth.accountId);
  headers.set("Accept", "application/sdp");
  headers.set("OAI-Language", options.session?.language ?? "en-US");
  headers.set("OAI-Device-Id", createUuid());
  headers.set("OAI-Client-Version", options.config.realtimeClientVersion);
  headers.set("OAI-Client-Build-Number", options.config.realtimeClientBuild);
  headers.set("OAI-Session-Id", createUuid());
  headers.set("X-OpenAI-Target-Path", path);
  headers.set("X-OpenAI-Target-Route", path);
  headers.set("Origin", options.config.realtimeBaseUrl);
  headers.set("Referer", `${options.config.realtimeBaseUrl}/`);

  const response = await options.config.fetch(`${options.config.realtimeBaseUrl}${path}?dcid=0`, {
    method: "POST",
    headers,
    body: form,
    signal: options.signal,
  });
  const body = await response.text();
  if (!response.ok) {
    throw new ChatGPTAuthError(
      "realtime_request_failed",
      `Realtime session request failed (${response.status}).`,
      { status: response.status, body },
    );
  }
  if (!body.trimStart().startsWith("v=0")) {
    throw new ChatGPTAuthError(
      "realtime_request_failed",
      "Realtime endpoint did not return an SDP answer.",
      { status: response.status, body },
    );
  }
  return body;
}

export function createChatGPTRealtimeAction(
  action: ChatGPTRealtimeAction | string,
  payload: Record<string, unknown> = {},
): ChatGPTRealtimeActionEvent {
  return { type: "action_request", payload: { ...payload, action } };
}

/** Encodes any action/event for the negotiated data channel. */
export function encodeChatGPTRealtimeEvent(event: ChatGPTRealtimeEvent): string {
  return JSON.stringify(event);
}

/**
 * Decodes both direct events and ChatGPT's nested `{type:"data_message",data}`
 * envelope. Unknown event types are returned unchanged for forward compatibility.
 */
export function parseChatGPTRealtimeEvent(input: unknown): ChatGPTRealtimeEvent | undefined {
  let value = decodeWireValue(input);
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch { return undefined; }
      continue;
    }
    if (isRecord(value) && value["type"] === "data_message" && "data" in value) {
      value = decodeWireValue(value["data"]);
      continue;
    }
    break;
  }
  return isRecord(value) && typeof value["type"] === "string"
    ? value as ChatGPTRealtimeEvent
    : undefined;
}

/** Returns the event's nested payload when present, otherwise the event itself. */
export function getChatGPTRealtimePayload(event: ChatGPTRealtimeEvent): Record<string, unknown> {
  return isRecord(event["payload"]) ? event["payload"] : event;
}

function decodeWireValue(value: unknown): unknown {
  if (value instanceof ArrayBuffer) return new TextDecoder().decode(value);
  if (ArrayBuffer.isView(value)) {
    return new TextDecoder().decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  if (Array.isArray(value) && value.every((item) => Number.isInteger(item))) {
    return new TextDecoder().decode(Uint8Array.from(value as number[]));
  }
  if (isRecord(value)) {
    const numeric = Object.keys(value);
    if (numeric.length > 0 && numeric.every((key) => /^\d+$/.test(key))) {
      return new TextDecoder().decode(Uint8Array.from(
        numeric.sort((a, b) => Number(a) - Number(b)).map((key) => Number(value[key])),
      ));
    }
  }
  return value;
}

function assignDefined(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
