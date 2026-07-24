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

    const confirmed = await session.resolveConfirmation("call_1", { approved: true });

    expect(confirmations).toEqual([{ approved: true }]);
    expect(confirmed).toEqual({ output: { status: "sent", draftId: "draft_1" } });
    expect(wire).toHaveLength(1);
    expect(events.at(-1)).toEqual({
      type: "tool.completed",
      callId: "call_1",
      name: "email_request_send_draft",
    });
  });

  test("claims confirmation atomically and prevents duplicate execution", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let confirmations = 0;
    const session = new ChatGPTRealtimeAppServerSession({
      tokens: { accessToken: "access", accountId: "acct_123" },
      tools: [{
        type: "function",
        name: "apply_change",
        description: "Apply a pending change after confirmation.",
        inputSchema: { type: "object" },
      }],
      executeTool: async () => ({
        output: { status: "pending_confirmation" },
        pendingConfirmation: { review: { changeId: "change_1" } },
      }),
      confirmTool: async () => {
        confirmations += 1;
        await gate;
        return { output: { status: "applied" } };
      },
    });
    (session as any).send = () => {};
    await (session as any).handleTool(1, {
      callId: "call_1",
      tool: "apply_change",
      arguments: {},
    });

    const first = session.resolveConfirmation("call_1", { approved: true });
    await expect(
      session.resolveConfirmation("call_1", { approved: true }),
    ).rejects.toThrow("no longer pending");
    release();
    await first;
    expect(confirmations).toBe(1);
  });

  test("restores a pending confirmation after an application failure", async () => {
    let attempts = 0;
    const session = new ChatGPTRealtimeAppServerSession({
      tokens: { accessToken: "access", accountId: "acct_123" },
      tools: [{
        type: "function",
        name: "apply_change",
        description: "Apply a pending change after confirmation.",
        inputSchema: { type: "object" },
      }],
      executeTool: async () => ({
        output: { status: "pending_confirmation" },
        pendingConfirmation: { review: { changeId: "change_1" } },
      }),
      confirmTool: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary failure");
        return { output: { status: "applied" } };
      },
    });
    (session as any).send = () => {};
    await (session as any).handleTool(1, {
      callId: "call_1",
      tool: "apply_change",
      arguments: {},
    });

    await expect(
      session.resolveConfirmation("call_1", { approved: true }),
    ).rejects.toThrow("temporary failure");
    await expect(
      session.resolveConfirmation("call_1", { approved: true }),
    ).resolves.toMatchObject({ output: { status: "applied" } });
    expect(attempts).toBe(2);
  });

  test("does not turn a completed confirmation into a failure when speech fails", async () => {
    const events: RealtimeBridgeEvent[] = [];
    const session = new ChatGPTRealtimeAppServerSession({
      tokens: { accessToken: "access", accountId: "acct_123" },
      tools: [{
        type: "function",
        name: "apply_change",
        description: "Apply a pending change after confirmation.",
        inputSchema: { type: "object" },
      }],
      executeTool: async () => ({
        output: { status: "pending_confirmation" },
        pendingConfirmation: { review: { changeId: "change_1" } },
      }),
      confirmTool: async () => ({
        output: { status: "applied" },
        speech: "The change was applied.",
      }),
    });
    (session as any).send = () => {};
    (session as any).threadId = "thread_1";
    (session as any).expectResult = async () => {
      throw new Error("voice transport closed");
    };
    session.onEvent((event) => events.push(event));
    await (session as any).handleTool(1, {
      callId: "call_1",
      tool: "apply_change",
      arguments: {},
    });

    await expect(
      session.resolveConfirmation("call_1", { approved: true }),
    ).resolves.toEqual({
      output: { status: "applied" },
      speech: "The change was applied.",
    });
    expect(events).toContainEqual({
      type: "error",
      message: "Confirmation completed, but its spoken acknowledgement failed: voice transport closed",
    });
    expect(events.at(-1)).toEqual({
      type: "tool.completed",
      callId: "call_1",
      name: "apply_change",
    });
  });
});
