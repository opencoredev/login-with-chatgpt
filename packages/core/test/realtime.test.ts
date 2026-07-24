import { describe, expect, test } from "bun:test";
import {
  buildChatGPTRealtimeSession,
  createChatGPTRealtimeAction,
  createChatGPTRealtimeRelayMessage,
  createChatGPTRealtimeToolResult,
  createChatGPTRealtimeToolUpdate,
  createChatGPTRealtimeCall,
  encodeChatGPTRealtimeEvent,
  exchangeChatGPTRealtimeWebSession,
  getChatGPTRealtimePayload,
  parseChatGPTRealtimeEvent,
  parseChatGPTRealtimeAppServerEvent,
  parseChatGPTRealtimeToolInvocation,
  resolveConfig,
} from "../src/index.ts";
import { createMockFetch, makeJwt } from "./helpers.ts";

describe("ChatGPT Realtime", () => {
  test("builds GPT Live and explicit compatibility session payloads", () => {
    const advanced = buildChatGPTRealtimeSession({
      voice: "ember",
      language: "fr-FR",
    });
    expect(advanced).toMatchObject({
      voice: "ember",
      voice_mode: "wingman",
      model_slug: "",
      language_code: "fr-FR",
    });
    expect(advanced.voice_session_id).toBe(advanced.voice_status_request_id);
    expect(advanced.client_tools).toEqual([]);
    expect(advanced).toMatchObject({
      backend_reasoning_effort: "high",
      chat_mode: "chat",
      enable_message_streaming: true,
      model_slug_advanced: "",
    });

    const standard = buildChatGPTRealtimeSession({ transport: "vps", voiceMode: "standard", model: "explicit-compat-model" });
    expect(standard.voice_mode).toBe("standard");
    expect(standard.model_slug).toBe("explicit-compat-model");
    expect(standard.model_slug_advanced).toBeUndefined();
    expect(() => buildChatGPTRealtimeSession({ voice: "" })).toThrow("`voice`");
    expect(() => buildChatGPTRealtimeSession({ timezoneOffsetMinutes: 2000 })).toThrow("timezoneOffsetMinutes");
    expect(() => buildChatGPTRealtimeSession({ historyAndTrainingDisabled: true })).toThrow("must be false");
    expect(() => buildChatGPTRealtimeSession({ transport: "wm", voiceMode: "advanced" })).toThrow("must be `wingman`");
    expect(() => buildChatGPTRealtimeSession({ transport: "bogus" as "wm" })).toThrow("`transport`");
    expect(() => buildChatGPTRealtimeSession({ transport: "vp" })).toThrow("`model` is required");
    expect(() => buildChatGPTRealtimeSession({
      clientTools: [{
        type: "function",
        name: "tool",
        parameters: { type: "object" },
      }] as unknown as never[],
    })).toThrow("reserved first-party device tool IDs");
  });

  test("posts multipart SDP with server-side ChatGPT auth", async () => {
    const fetch = createMockFetch(() => new Response("v=0\r\no=- answer", { status: 201 }));
    const config = resolveConfig({ fetch });
    const answer = await createChatGPTRealtimeCall({
      config,
      getAuth: () => ({
        accessToken: "access-secret",
        accountId: "acct_123",
        deviceId: "8aacad9c-15c9-4d87-9516-855d3d223bf8",
      }),
      sdp: "v=0\r\no=- offer",
      session: { voice: "juniper", transport: "wm" },
    });

    expect(answer).toStartWith("v=0");
    expect(fetch.calls).toHaveLength(1);
    const call = fetch.calls[0]!;
    expect(call.url).toBe("https://chatgpt.com/realtime/wm?dcid=0");
    const headers = new Headers(call.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer access-secret");
    expect(headers.get("chatgpt-account-id")).toBe("acct_123");
    expect(headers.get("oai-device-id")).toBe("8aacad9c-15c9-4d87-9516-855d3d223bf8");
    expect(headers.has("openai-beta")).toBeFalse();
    const form = call.init?.body as FormData;
    expect(form.get("sdp")).toBe("v=0\r\no=- offer");
    expect(JSON.parse(String(form.get("session")))).toMatchObject({
      voice: "juniper",
      voice_mode: "wingman",
      history_and_training_disabled: false,
    });
  });

  test("mints and validates the web-client auth required by /wm", async () => {
    const accessToken = makeJwt({ client_id: "app_X8zY6vW2pQ9tR3dE7nK1jL5gH" });
    const responseHeaders = new Headers({ "content-type": "application/json" });
    responseHeaders.append("set-cookie", "__Secure-next-auth.session-token=; Max-Age=0; Secure");
    responseHeaders.append("set-cookie", "__Secure-next-auth.session-token.0=chunk-zero; Secure; HttpOnly");
    responseHeaders.append("set-cookie", "__Secure-next-auth.session-token.1=chunk-one; Secure; HttpOnly");
    const fetch = createMockFetch(() => new Response(
      JSON.stringify({
        accessToken,
        account: { id: "acct_web" },
        user: { email: "person@example.com" },
        expires: "2030-01-01T00:00:00.000Z",
      }),
      { headers: responseHeaders },
    ));
    let updated: unknown;
    const auth = await exchangeChatGPTRealtimeWebSession({
      config: resolveConfig({ fetch }),
      sessionToken: "opaque-session-secret",
      deviceId: "8aacad9c-15c9-4d87-9516-855d3d223bf8",
      onSessionUpdate: (state) => {
        updated = state;
      },
    });
    expect(auth).toMatchObject({
      accessToken,
      accountId: "acct_web",
      email: "person@example.com",
      deviceId: "8aacad9c-15c9-4d87-9516-855d3d223bf8",
      sessionCookies: {
        "__Secure-next-auth.session-token.0": "chunk-zero",
        "__Secure-next-auth.session-token.1": "chunk-one",
      },
    });
    expect(updated).toEqual({
      deviceId: auth.deviceId,
      sessionCookies: auth.sessionCookies,
    });
    const headers = new Headers(fetch.calls[0]?.init?.headers);
    expect(headers.get("cookie")).toBe(
      "__Secure-next-auth.session-token=opaque-session-secret; oai-did=8aacad9c-15c9-4d87-9516-855d3d223bf8",
    );
    expect(headers.get("oai-device-id")).toBe("8aacad9c-15c9-4d87-9516-855d3d223bf8");
  });

  test("distinguishes a ChatGPT edge rejection from an expired web session", async () => {
    const fetch = createMockFetch(() => new Response("challenge", { status: 403 }));

    expect(
      exchangeChatGPTRealtimeWebSession({
        config: resolveConfig({ fetch }),
        sessionToken: "opaque-session-secret",
        deviceId: "8aacad9c-15c9-4d87-9516-855d3d223bf8",
      }),
    ).rejects.toMatchObject({
      code: "realtime_web_edge_rejected",
      status: 502,
    });
  });

  test("decodes direct, nested, byte, and numeric-key events", () => {
    const event = { type: "state_update", new_state: "speaking" };
    expect(parseChatGPTRealtimeEvent(JSON.stringify(event))).toEqual(event);
    expect(parseChatGPTRealtimeEvent(JSON.stringify({ type: "data_message", data: JSON.stringify(event) }))).toEqual(event);
    expect(parseChatGPTRealtimeEvent(new TextEncoder().encode(JSON.stringify(event)))).toEqual(event);
    expect(parseChatGPTRealtimeEvent({ ...new TextEncoder().encode(JSON.stringify(event)) })).toEqual(event);
    expect(parseChatGPTRealtimeEvent("not-json")).toBeUndefined();
    expect(getChatGPTRealtimePayload({ type: "state_update", payload: { new_state: "speaking" } })).toEqual({
      new_state: "speaking",
    });
  });

  test("encodes interruption and other control actions", () => {
    expect(createChatGPTRealtimeAction("stop_speaking")).toEqual({
      type: "action_request",
      payload: { action: "stop_speaking" },
    });
    expect(createChatGPTRealtimeAction("relay_message", { text: "hello" })).toEqual({
      type: "action_request",
      payload: { text: "hello", action: "relay_message" },
    });
    const wrapped = JSON.parse(encodeChatGPTRealtimeEvent(createChatGPTRealtimeAction("stop_speaking")));
    expect(wrapped.type).toBe("data_message");
    expect(JSON.parse(wrapped.data).type).toBe("action_request");

    expect(createChatGPTRealtimeRelayMessage("hello")).toMatchObject({
      type: "relay_message",
      payload: { type: "relay_message", message: { content: { parts: ["hello"] } } },
    });
  });

  test("parses client-tool calls and builds structured lifecycle events", () => {
    expect(parseChatGPTRealtimeToolInvocation({
      type: "client_tool_invoke",
      payload: {
        call_id: "call-1",
        name: "draft_email",
        arguments: "{\"subject\":\"Hello\"}",
      },
    })).toEqual({
      callId: "call-1",
      name: "draft_email",
      arguments: { subject: "Hello" },
    });
    expect(parseChatGPTRealtimeToolInvocation({
      type: "client_tool_invoke",
      payload: { call_id: "call-1", name: "draft_email", arguments: "not-json" },
    })).toBeUndefined();
    expect(createChatGPTRealtimeToolUpdate("call-1", "pending_confirmation", {
      draft_id: "draft-1",
    })).toEqual({
      type: "client_tool_update",
      call_id: "call-1",
      status: "pending_confirmation",
      draft_id: "draft-1",
    });
    expect(createChatGPTRealtimeToolResult("call-1", {
      status: "sent",
      sent: true,
    })).toEqual({
      type: "client_tool_result",
      call_id: "call-1",
      result: { status: "sent", sent: true },
    });
  });

  test("parses desktop-style app-server lifecycle events", () => {
    expect(parseChatGPTRealtimeAppServerEvent({
      type: "tool.pending_confirmation",
      callId: "call-1",
      name: "create_record",
      review: { title: "Review me" },
    })).toEqual({
      type: "tool.pending_confirmation",
      callId: "call-1",
      name: "create_record",
      review: { title: "Review me" },
    });
    expect(parseChatGPTRealtimeAppServerEvent({
      type: "tool.pending_confirmation",
      callId: "call-1",
      review: {},
    })).toBeUndefined();
    expect(parseChatGPTRealtimeAppServerEvent({
      type: "error",
    })).toBeUndefined();
    expect(parseChatGPTRealtimeAppServerEvent({ type: "unknown" })).toBeUndefined();
    expect(parseChatGPTRealtimeAppServerEvent("not-an-event")).toBeUndefined();
  });

});
