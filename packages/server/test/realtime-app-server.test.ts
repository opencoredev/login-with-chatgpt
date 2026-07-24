import { describe, expect, test } from "bun:test";
import {
  ChatGPTRealtimeAppServerSession,
  chatgptPlanType,
  realtimeExecutionConfig,
  type RealtimeBridgeEvent,
} from "../src/realtime-app-server.ts";

function jwt(payload: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

describe("ChatGPTRealtimeAppServerSession", () => {
  test("preserves the signed ChatGPT plan entitlement", () => {
    const accessToken = jwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_123",
        chatgpt_plan_type: "pro",
      },
    });

    expect(chatgptPlanType({ accessToken, accountId: "acct_123" })).toBe("pro");
  });

  test("uses the selected model for delegated execution", () => {
    expect(realtimeExecutionConfig({ model: "gpt-5.6-luna" })).toEqual({
      model: "gpt-5.6-luna",
      config: { model_reasoning_effort: "low" },
    });
  });

  test("rejects reserved and duplicate dynamic-tool names", () => {
    const base = {
      tokens: { accessToken: "access", accountId: "acct_123" },
      executeTool: async () => ({ output: {} }),
    };
    expect(() => new ChatGPTRealtimeAppServerSession({
      ...base,
      tools: [{
        type: "function",
        name: "speak_to_user",
        description: "reserved",
        inputSchema: {},
      }],
    })).toThrow("reserved");
    expect(() => new ChatGPTRealtimeAppServerSession({
      ...base,
      tools: [{
        type: "function",
        name: "email",
        description: "first",
        inputSchema: {},
      }, {
        type: "function",
        name: "email",
        description: "second",
        inputSchema: {},
      }],
    })).toThrow("Duplicate");
  });

  test("returns pending confirmation without blocking the app-server request", async () => {
    const confirmations: unknown[] = [];
    const session = new ChatGPTRealtimeAppServerSession({
      tokens: { accessToken: "access", accountId: "acct_123" },
      tools: [{
        type: "function",
        name: "email_request_send_draft",
        description: "Request review before sending a draft.",
        inputSchema: { type: "object" },
      }],
      executeTool: async () => ({
        output: { status: "pending_confirmation", draftId: "draft_1" },
        pendingConfirmation: {
          review: { draftId: "draft_1", to: ["person@example.com"] },
        },
      }),
      confirmTool: async ({ confirmation }) => {
        confirmations.push(confirmation);
        return { output: { status: "sent", draftId: "draft_1" } };
      },
    });
    const wire: Array<Record<string, unknown>> = [];
    const events: RealtimeBridgeEvent[] = [];
    session.onEvent((event) => events.push(event));
    (session as any).send = (message: Record<string, unknown>) => wire.push(message);

    await (session as any).handleTool(41, {
      callId: "call_1",
      tool: "email_request_send_draft",
      arguments: { draftId: "draft_1" },
    });

    expect(wire).toHaveLength(1);
    expect(wire[0]?.id).toBe(41);
    expect((wire[0]?.result as Record<string, unknown>)?.success).toBe(true);
    expect(events.at(-1)).toEqual({
      type: "tool.pending_confirmation",
      callId: "call_1",
      name: "email_request_send_draft",
      review: { draftId: "draft_1", to: ["person@example.com"] },
    });

    await session.resolveConfirmation("call_1", { approved: true });

    expect(confirmations).toEqual([{ approved: true }]);
    expect(wire).toHaveLength(1);
    expect(events.at(-1)).toEqual({
      type: "tool.completed",
      callId: "call_1",
      name: "email_request_send_draft",
    });
  });
});
