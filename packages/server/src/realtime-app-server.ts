import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ChatGPTTokens } from "@opencoredev/loginwithchatgpt-core";

export interface RealtimeDynamicTool {
  type: "function";
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface RealtimeToolContext {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface RealtimeToolResult {
  /** JSON-serializable structured result returned to the execution agent. */
  output: unknown;
  /** Keep the action pending in application UI until `resolveConfirmation()` is called. */
  pendingConfirmation?: {
    /** Safe review payload sent to the browser status stream. */
    review: unknown;
  };
}

export interface RealtimeConfirmationResult {
  /** JSON-serializable application result returned by `resolveConfirmation()`. */
  output: unknown;
  /** Optional short acknowledgement spoken through the native Live session. */
  speech?: string;
}

export type RealtimeBridgeEvent =
  | { type: "session.started" }
  | { type: "session.closed" }
  | { type: "handoff"; transcript: string }
  | { type: "tool.running"; callId: string; name: string }
  | { type: "tool.completed"; callId: string; name: string }
  | { type: "tool.pending_confirmation"; callId: string; name: string; review: unknown }
  | { type: "tool.failed"; callId?: string; name?: string; message: string }
  | { type: "error"; message: string };

export interface ChatGPTRealtimeAppServerOptions {
  tokens: ChatGPTTokens;
  refreshTokens?: () => Promise<ChatGPTTokens>;
  tools: readonly RealtimeDynamicTool[];
  executeTool: (context: RealtimeToolContext) => Promise<RealtimeToolResult>;
  /**
   * Called only after the application receives an explicit confirmation.
   * `confirmation` is application-defined (for example `{ approved: true }`).
   */
  confirmTool?: (
    context: RealtimeToolContext & { confirmation: unknown; pending: RealtimeToolResult },
  ) => Promise<RealtimeConfirmationResult>;
  /** Defaults to the `codex` executable on PATH. */
  command?: readonly string[];
  executionInstructions?: string;
  realtimePrompt?: string;
  cwd?: string;
}

export interface StartRealtimeAppServerOptions {
  sdp: string;
  voice?: string;
  /**
   * Model used for delegated execution turns. Pass the signed-in user's
   * selected Codex model (for example `gpt-5.6-luna`) so app-server applies
   * the matching model entitlement and quota.
   */
  model?: string;
  /** Defaults to `low` for responsive voice-tool turns. */
  reasoningEffort?: string;
}

type JsonObject = Record<string, unknown>;

interface PendingConfirmation {
  context: RealtimeToolContext;
  result: RealtimeToolResult;
}

const SPEAK_TOOL = "speak_to_user";
const DEFAULT_EXECUTION_INSTRUCTIONS =
  "You are the execution side of one native realtime voice assistant. Requests arrive inside " +
  "<realtime_delegation>. Use dynamic tools whenever private data or an external action is needed. " +
  "After completing a request, call speak_to_user exactly once with a concise result. Never claim " +
  "a tool is unavailable before calling it. Consequential actions may wait for on-screen confirmation.";
const DEFAULT_REALTIME_PROMPT =
  "You are the native realtime voice surface of one assistant. Keep speech natural, concise, and " +
  "interruptible. Answer ordinary conversation directly. For requests requiring tools, private data, " +
  "or actions, use the native backend handoff to the execution agent.";

/**
 * Node/Bun app-server bridge matching the ChatGPT desktop Realtime protocol.
 *
 * WebRTC audio remains browser-to-OpenAI. This process mediates only native
 * `handoff_request` items, dynamic tools, confirmations, and spoken results.
 */
export class ChatGPTRealtimeAppServerSession {
  readonly id = crypto.randomUUID();

  private readonly options: ChatGPTRealtimeAppServerOptions;
  private readonly listeners = new Set<(event: RealtimeBridgeEvent) => void>();
  private process?: ChildProcessWithoutNullStreams;
  private home?: string;
  private threadId?: string;
  private requestId = 0;
  private closed = false;
  private pendingRequests = new Map<string | number, {
    resolve: (value: JsonObject) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private notificationWaiters = new Map<string, Array<(params: JsonObject) => void>>();
  private confirmations = new Map<string, PendingConfirmation>();
  private allowedTools: Set<string>;

  constructor(options: ChatGPTRealtimeAppServerOptions) {
    if (!options.tokens.accessToken || !options.tokens.accountId) {
      throw new TypeError("App-server Realtime requires accessToken and accountId.");
    }
    this.allowedTools = new Set();
    for (const tool of options.tools) {
      if (!tool.name || tool.name === SPEAK_TOOL) {
        throw new TypeError(`Dynamic tool name "${tool.name}" is reserved or invalid.`);
      }
      if (this.allowedTools.has(tool.name)) {
        throw new TypeError(`Duplicate dynamic tool name: ${tool.name}`);
      }
      this.allowedTools.add(tool.name);
    }
    this.options = options;
  }

  async start(options: StartRealtimeAppServerOptions): Promise<string> {
    if (!options.sdp.trim()) throw new TypeError("`sdp` must be a non-empty WebRTC offer.");
    if (this.process) throw new Error("Realtime app-server session has already started.");
    this.home = join(tmpdir(), `login-with-chatgpt-live-${this.id}`);
    await mkdir(this.home, { recursive: false, mode: 0o700 });
    await this.writeAuth(this.options.tokens);

    const command = this.options.command ?? [
      "codex", "--enable", "realtime_conversation", "app-server", "--stdio",
    ];
    const [executable, ...args] = command;
    if (!executable) throw new TypeError("App-server command cannot be empty.");
    this.process = spawn(executable, args, {
      cwd: this.options.cwd ?? this.home,
      env: { ...process.env, CODEX_HOME: this.home, RUST_LOG: process.env["RUST_LOG"] ?? "warn" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process.once("exit", () => {
      if (!this.closed) this.emit({ type: "error", message: "Codex app-server stopped unexpectedly." });
      for (const pending of this.pendingRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Codex app-server stopped."));
      }
      this.pendingRequests.clear();
    });
    createInterface({ input: this.process.stdout }).on("line", (line) => this.handleLine(line));
    createInterface({ input: this.process.stderr }).on("line", () => {
      // Deliberately avoid forwarding stderr: it may contain application context.
    });

    await this.expectResult("initialize", {
      clientInfo: { name: "codex_desktop", title: "Codex Desktop", version: "1" },
      capabilities: {
        experimentalApi: true,
        requestAttestation: true,
        mcpServerOpenaiFormElicitation: true,
        optOutNotificationMethods: [],
      },
    });
    this.notify("initialized", {});
    const thread = await this.expectResult("thread/start", {
      cwd: this.options.cwd ?? this.home,
      ephemeral: true,
      approvalPolicy: "never",
      sandbox: "read-only",
      threadSource: "realtime_voice",
      baseInstructions: this.options.executionInstructions ?? DEFAULT_EXECUTION_INSTRUCTIONS,
      developerInstructions: this.options.executionInstructions ?? DEFAULT_EXECUTION_INSTRUCTIONS,
      dynamicTools: [...this.options.tools, speakToolSpec()],
      ...realtimeExecutionConfig(options),
    });
    const threadValue = asRecord(asRecord(thread["result"])?.["thread"]);
    if (typeof threadValue?.["id"] !== "string") throw new Error("App-server returned no thread id.");
    this.threadId = threadValue["id"];

    const sdpNotification = this.waitForNotification("thread/realtime/sdp", 30_000);
    await this.expectResult("thread/realtime/start", {
      threadId: this.threadId,
      outputModality: "audio",
      clientManagedHandoffs: false,
      flushTranscriptTailOnSessionEnd: true,
      codexResponsesAsItems: false,
      includeStartupContext: false,
      prompt: this.options.realtimePrompt ?? DEFAULT_REALTIME_PROMPT,
      transport: { type: "webrtc", sdp: options.sdp },
      version: "v3",
      voice: options.voice ?? "juniper",
    }, 45_000);
    const notification = await sdpNotification;
    const answer = notification["sdp"];
    if (typeof answer !== "string" || !answer.trimStart().startsWith("v=0")) {
      throw new Error("App-server returned an invalid SDP answer.");
    }
    this.emit({ type: "session.started" });
    return answer;
  }

  onEvent(listener: (event: RealtimeBridgeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Resolves an application-owned pending action. The dynamic-tool request has
   * already completed with a pending result, so native Live remains responsive
   * while the UI waits. The bridge never assumes approval from speech.
   */
  async resolveConfirmation(
    callId: string,
    confirmation: unknown,
  ): Promise<RealtimeConfirmationResult> {
    const pending = this.confirmations.get(callId);
    if (!pending) throw new Error("Tool confirmation is no longer pending.");
    if (!this.options.confirmTool) throw new Error("No confirmTool handler is configured.");
    // Claim before awaiting so duplicate clicks or requests cannot execute the
    // consequential action twice. Restore only when the application handler
    // fails and it is safe for the UI to retry.
    this.confirmations.delete(callId);
    let confirmed: RealtimeConfirmationResult;
    try {
      confirmed = await this.options.confirmTool({
        ...pending.context,
        confirmation,
        pending: pending.result,
      });
    } catch (error) {
      this.confirmations.set(callId, pending);
      throw error;
    }
    assertJsonSerializable(confirmed.output, "Confirmation output");
    if (confirmed.speech) {
      try {
        await this.speak(confirmed.speech);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.emit({
          type: "error",
          message: `Confirmation completed, but its spoken acknowledgement failed: ${message}`,
        });
      }
    }
    this.emit({ type: "tool.completed", callId, name: pending.context.name });
    return confirmed;
  }

  async speak(text: string): Promise<void> {
    if (!this.threadId || !text.trim()) return;
    await this.expectResult("thread/realtime/appendSpeech", {
      threadId: this.threadId,
      text: text.trim(),
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.threadId && this.process?.exitCode === null) {
      await this.expectResult("thread/realtime/stop", { threadId: this.threadId }, 5_000).catch(() => {});
    }
    this.process?.stdin.end();
    if (this.process?.exitCode === null) {
      const process = this.process;
      const exited = new Promise<void>((resolve) => process.once("exit", () => resolve()));
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2_000));
      await Promise.race([exited, timeout]);
      if (process.exitCode === null) process.kill("SIGTERM");
    }
    if (this.home) await rm(this.home, { recursive: true, force: true });
    this.emit({ type: "session.closed" });
  }

  private async writeAuth(tokens: ChatGPTTokens): Promise<void> {
    if (!this.home) return;
    await writeFile(join(this.home, "auth.json"), JSON.stringify({
      auth_mode: "chatgpt",
      last_refresh: new Date().toISOString(),
      OPENAI_API_KEY: null,
      tokens: {
        access_token: tokens.accessToken,
        account_id: tokens.accountId,
        id_token: tokens.idToken ?? null,
        refresh_token: tokens.refreshToken ?? null,
      },
    }), { mode: 0o600 });
  }

  private handleLine(line: string): void {
    let message: JsonObject;
    try {
      message = JSON.parse(line) as JsonObject;
    } catch {
      return;
    }
    const id = message["id"];
    if ((typeof id === "string" || typeof id === "number") &&
        ("result" in message || "error" in message) && this.pendingRequests.has(id)) {
      const pending = this.pendingRequests.get(id)!;
      clearTimeout(pending.timer);
      this.pendingRequests.delete(id);
      pending.resolve(message);
      return;
    }
    const method = message["method"];
    if (typeof method !== "string") return;
    const params = asRecord(message["params"]) ?? {};
    const waiters = this.notificationWaiters.get(method) ?? [];
    this.notificationWaiters.delete(method);
    for (const waiter of waiters) waiter(params);
    if (typeof id === "string" || typeof id === "number") {
      void this.handleServerRequest(id, method, params);
    } else {
      this.handleNotification(method, params);
    }
  }

  private async handleServerRequest(
    id: string | number,
    method: string,
    params: JsonObject,
  ): Promise<void> {
    try {
      if (method === "attestation/generate") {
        this.send({ id, result: { token: unsupportedAttestationToken() } });
        return;
      }
      if (method === "account/chatgptAuthTokens/refresh") {
        const tokens = await this.options.refreshTokens?.();
        if (!tokens?.accessToken || !tokens.accountId) throw new Error("Token refresh is unavailable.");
        await this.writeAuth(tokens);
        this.send({
          id,
          result: {
            accessToken: tokens.accessToken,
            chatgptAccountId: tokens.accountId,
            chatgptPlanType: chatgptPlanType(tokens),
          },
        });
        return;
      }
      if (method !== "item/tool/call") {
        this.send({ id, error: { code: -32601, message: `Unsupported request: ${method}` } });
        return;
      }
      await this.handleTool(id, params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (method === "item/tool/call") {
        this.send({ id, result: dynamicToolResponse({ status: "error", message }, false) });
      } else {
        this.send({ id, error: { code: -32000, message } });
      }
      if (method === "item/tool/call") {
        this.emit({
          type: "tool.failed",
          callId: typeof params["callId"] === "string" ? params["callId"] : undefined,
          name: typeof params["tool"] === "string" ? params["tool"] : undefined,
          message,
        });
      } else {
        this.emit({ type: "error", message });
      }
    }
  }

  private async handleTool(id: string | number, params: JsonObject): Promise<void> {
    const callId = params["callId"];
    const name = params["tool"];
    const args = asRecord(params["arguments"]);
    if (typeof callId !== "string" || typeof name !== "string" || !args) {
      throw new Error("App-server returned an invalid dynamic-tool request.");
    }
    if (name !== SPEAK_TOOL && !this.allowedTools.has(name)) {
      throw new Error(`App-server requested an unregistered dynamic tool: ${name}`);
    }
    const context = { callId, name, arguments: args };
    this.emit({ type: "tool.running", callId, name });
    if (name === SPEAK_TOOL) {
      const text = args["text"];
      if (typeof text !== "string" || !text.trim()) throw new Error("speak_to_user requires text.");
      await this.speak(text);
      this.send({ id, result: dynamicToolResponse({ status: "spoken" }) });
      this.emit({ type: "tool.completed", callId, name });
      return;
    }
    const result = await this.options.executeTool(context);
    if (result.pendingConfirmation) {
      if (!this.options.confirmTool) throw new Error("Tool requested confirmation without confirmTool.");
      assertJsonSerializable(result.pendingConfirmation.review, "Confirmation review");
      // A JSON-RPC request left open blocks subsequent realtime handoffs and
      // wedges the native session in "thinking". Return the structured pending
      // result now; only the consequential application action stays gated.
      this.send({ id, result: dynamicToolResponse(result.output) });
      this.confirmations.set(callId, { context, result });
      this.emit({
        type: "tool.pending_confirmation",
        callId,
        name,
        review: result.pendingConfirmation.review,
      });
      return;
    }
    this.send({ id, result: dynamicToolResponse(result.output) });
    this.emit({ type: "tool.completed", callId, name });
  }

  private handleNotification(method: string, params: JsonObject): void {
    if (method === "thread/realtime/itemAdded") {
      const item = asRecord(params["item"]);
      if (item?.["type"] === "handoff_request") {
        this.emit({
          type: "handoff",
          transcript: typeof item["input_transcript"] === "string"
            ? item["input_transcript"]
            : typeof item["input"] === "string"
              ? item["input"]
              : "",
        });
      }
    } else if (method === "thread/realtime/error") {
      this.emit({ type: "error", message: String(params["message"] ?? params["error"] ?? "Realtime error") });
    } else if (method === "thread/realtime/closed") {
      this.emit({ type: "session.closed" });
    }
  }

  private request(method: string, params: JsonObject, timeoutMs = 30_000): Promise<JsonObject> {
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Timed out waiting for ${method}.`));
      }, timeoutMs);
      this.pendingRequests.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }

  private async expectResult(method: string, params: JsonObject, timeoutMs?: number): Promise<JsonObject> {
    const response = await this.request(method, params, timeoutMs);
    const error = asRecord(response["error"]);
    if (error) throw new Error(typeof error["message"] === "string" ? error["message"] : `${method} failed.`);
    return response;
  }

  private notify(method: string, params: JsonObject): void {
    this.send({ method, params });
  }

  private send(message: JsonObject): void {
    if (!this.process?.stdin.writable) throw new Error("Codex app-server is not running.");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private waitForNotification(method: string, timeoutMs: number): Promise<JsonObject> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}.`)), timeoutMs);
      const wrapped = (params: JsonObject) => {
        clearTimeout(timer);
        resolve(params);
      };
      this.notificationWaiters.set(method, [...(this.notificationWaiters.get(method) ?? []), wrapped]);
    });
  }

  private emit(event: RealtimeBridgeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // An application status listener must not interrupt protocol handling.
      }
    }
  }
}

function speakToolSpec(): RealtimeDynamicTool {
  return {
    type: "function",
    name: SPEAK_TOOL,
    description: "Speak one concise result through the active native GPT Live session.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
  };
}

function dynamicToolResponse(output: unknown, success = true): JsonObject {
  const text = assertJsonSerializable(output, "Dynamic tool output");
  return {
    success,
    contentItems: [{ type: "inputText", text }],
  };
}

function assertJsonSerializable(output: unknown, label: string): string {
  const text = JSON.stringify(output);
  if (text === undefined) throw new TypeError(`${label} must be JSON-serializable.`);
  return text;
}

export function chatgptPlanType(tokens: ChatGPTTokens): string | undefined {
  for (const token of [tokens.idToken, tokens.accessToken]) {
    if (!token) continue;
    try {
      const encoded = token.split(".")[1];
      if (!encoded) continue;
      const claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as JsonObject;
      const auth = asRecord(claims["https://api.openai.com/auth"]);
      const plan = auth?.["chatgpt_plan_type"];
      if (typeof plan === "string" && plan) return plan;
    } catch {
      // Try the other signed token.
    }
  }
  return undefined;
}

/** @internal Builds the entitlement-sensitive app-server execution selection. */
export function realtimeExecutionConfig(
  options: Pick<StartRealtimeAppServerOptions, "model" | "reasoningEffort">,
): JsonObject {
  return {
    ...(options.model ? { model: options.model } : {}),
    config: { model_reasoning_effort: options.reasoningEffort ?? "low" },
  };
}

function unsupportedAttestationToken(): string {
  const encoder = new TextEncoder();
  const text = (value: string) => {
    const bytes = encoder.encode(value);
    if (bytes.length >= 24) throw new Error("Attestation field is unexpectedly long.");
    return Uint8Array.from([0x60 + bytes.length, ...bytes]);
  };
  const bytes = Uint8Array.from([
    0xa2,
    ...text("error_code"), 0x01,
    ...text("bundle_id"), ...text("com.openai.codex"),
  ]);
  return `v1.${Buffer.from(bytes).toString("base64url")}`;
}

function asRecord(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}
