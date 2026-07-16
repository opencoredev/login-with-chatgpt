import { describe, expect, test } from "bun:test";
import {
  buildChatGPTRealtimeSession,
  createChatGPTRealtimeAction,
  createChatGPTRealtimeCall,
  getChatGPTRealtimePayload,
  parseChatGPTRealtimeEvent,
  resolveConfig,
} from "../src/index.ts";
import { createMockFetch } from "./helpers.ts";

describe("ChatGPT Realtime", () => {
  test("builds advanced and standard session payloads", () => {
    const advanced = buildChatGPTRealtimeSession({
      voice: "ember",
      language: "fr-FR",
      clientTools: [{ name: "open_panel", parameters: { type: "object" } }],
      modelSpeaksFirst: true,
    });
    expect(advanced).toMatchObject({
      voice: "ember",
      voice_mode: "advanced",
      model_slug: "gpt-4o",
      model_slug_advanced: "gpt-4o",
      language_code: "fr-FR",
      model_speaks_first: true,
    });
    expect(advanced.voice_session_id).toBe(advanced.voice_status_request_id);
    expect(advanced.client_tools).toHaveLength(1);

    const standard = buildChatGPTRealtimeSession({ voiceMode: "standard", model: "gpt-4o-mini" });
    expect(standard.voice_mode).toBe("standard");
    expect(standard.model_slug).toBe("gpt-4o-mini");
    expect(standard.model_slug_advanced).toBeUndefined();
    expect(() => buildChatGPTRealtimeSession({ voice: "" })).toThrow("`voice`");
    expect(() => buildChatGPTRealtimeSession({ timezoneOffsetMinutes: 2000 })).toThrow("timezoneOffsetMinutes");
  });

  test("posts multipart SDP with server-side ChatGPT auth", async () => {
    const fetch = createMockFetch(() => new Response("v=0\r\no=- answer", { status: 201 }));
    const config = resolveConfig({ fetch });
    const answer = await createChatGPTRealtimeCall({
      config,
      getAuth: () => ({ accessToken: "access-secret", accountId: "acct_123" }),
      sdp: "v=0\r\no=- offer",
      session: { voice: "juniper", voiceMode: "advanced" },
    });

    expect(answer).toStartWith("v=0");
    expect(fetch.calls).toHaveLength(1);
    const call = fetch.calls[0]!;
    expect(call.url).toBe("https://chatgpt.com/realtime/vp?dcid=0");
    const headers = new Headers(call.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer access-secret");
    expect(headers.get("chatgpt-account-id")).toBe("acct_123");
    expect(headers.has("openai-beta")).toBeFalse();
    const form = call.init?.body as FormData;
    expect(form.get("sdp")).toBe("v=0\r\no=- offer");
    expect(JSON.parse(String(form.get("session")))).toMatchObject({ voice: "juniper", voice_mode: "advanced" });
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
  });
});
