import { describe, expect, test } from "bun:test";
import {
  createCodexFetch,
  extractCodexModelSlugs,
  listCodexModels,
  normalizeResponsesBody,
  resolveConfig,
  resolveTargetUrl,
} from "../src/index.ts";
import { createMockFetch, jsonResponse } from "./helpers.ts";

describe("codex transport", () => {
  test("normalizeResponsesBody adds all Codex stateless requirements", () => {
    const out = normalizeResponsesBody({ input: "hi", max_output_tokens: 100 }, { instructions: "sys" });
    expect(out.instructions).toBe("sys");
    expect(out.store).toBe(false);
    expect(out.reasoning).toEqual({ effort: "medium", summary: "auto" });
    expect(out.text).toEqual({ verbosity: "medium" });
    expect(out.include).toContain("reasoning.encrypted_content");
    expect(out.max_output_tokens).toBeUndefined();
  });

  test("normalizeResponsesBody keeps caller instructions and merges reasoning overrides", () => {
    const out = normalizeResponsesBody(
      { input: "hi", instructions: "keep", reasoning: { effort: "high" } },
      { reasoningEffort: "low" },
    );
    expect(out.instructions).toBe("keep");
    // caller-provided reasoning.effort wins over the option default
    expect((out.reasoning as { effort: string }).effort).toBe("high");
    // store is always forced false for the ChatGPT backend
    expect(out.store).toBe(false);
  });

  test("normalizeResponsesBody accepts Codex service tier defaults", () => {
    const out = normalizeResponsesBody({ input: "hi" }, { serviceTier: "fast" });
    expect(out.service_tier).toBe("fast");

    const callerTier = normalizeResponsesBody({ input: "hi", service_tier: "flex" }, { serviceTier: "fast" });
    expect(callerTier.service_tier).toBe("flex");
  });

  test("normalizeResponsesBody strips input ids and drops item_reference", () => {
    const out = normalizeResponsesBody({
      input: [
        { id: "msg_1", type: "message", role: "user", content: [] },
        { type: "item_reference", id: "ref_1" },
      ],
    });
    const input = out.input as Array<Record<string, unknown>>;
    expect(input).toHaveLength(1);
    expect(input[0]).not.toHaveProperty("id");
    expect(input[0]?.type).toBe("message");
  });

  test("resolveTargetUrl maps absolute and relative inputs onto the codex base", () => {
    const base = "https://chatgpt.com/backend-api/codex";
    expect(resolveTargetUrl("https://api.openai.com/v1/responses", base)).toBe(`${base}/responses`);
    expect(resolveTargetUrl("/responses", base)).toBe(`${base}/responses`);
    expect(resolveTargetUrl(`${base}/responses`, base)).toBe(`${base}/responses`);
  });

  test("createCodexFetch injects auth headers and normalizes the body", async () => {
    const fetch = createMockFetch(() => new Response("ok", { status: 200 }));
    const config = resolveConfig({ fetch });
    const codexFetch = createCodexFetch({
      config,
      getAuth: () => ({ accessToken: "at", accountId: "acct_1" }),
      instructions: "sys",
    });

    await codexFetch("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "m", input: "hi", max_output_tokens: 5 }),
    });

    const call = fetch.calls[0];
    const headers = new Headers(call?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer at");
    expect(headers.get("chatgpt-account-id")).toBe("acct_1");
    expect(headers.get("openai-beta")).toBe("responses=experimental");
    expect(headers.get("originator")).toBe("codex_cli_rs");

    const body = JSON.parse(String(call?.init?.body));
    expect(body.instructions).toBe("sys");
    expect(body.store).toBe(false);
    expect(body.max_output_tokens).toBeUndefined();

    // The ChatGPT backend gates models on client_version — it must be sent.
    expect(call?.url).toContain("client_version=");
  });

  test("createCodexFetch preserves an explicit client_version", async () => {
    const fetch = createMockFetch(() => new Response("ok"));
    const config = resolveConfig({ fetch, clientVersion: "9.9.9" });
    const codexFetch = createCodexFetch({ config, getAuth: () => ({ accessToken: "at", accountId: "a" }) });
    await codexFetch("https://chatgpt.com/backend-api/codex/responses", { method: "POST" });
    expect(fetch.calls[0]?.url).toContain("client_version=9.9.9");
  });

  test("extractCodexModelSlugs supports known model-list wrappers", () => {
    expect(
      extractCodexModelSlugs({
        models: [{ slug: "gpt-a" }, { id: "gpt-b" }, { slug: "gpt-a" }, { slug: "" }],
        data: [{ model: "gpt-c" }],
      }),
    ).toEqual(["gpt-a", "gpt-b", "gpt-c"]);
    expect(extractCodexModelSlugs({ models: [], data: [{ model: "gpt-c" }] })).toEqual(["gpt-c"]);
    expect(extractCodexModelSlugs([{ name: "gpt-d" }])).toEqual(["gpt-d"]);
    expect(extractCodexModelSlugs({ models: ["gpt-5.5", "gpt-5.4"] })).toEqual(["gpt-5.5", "gpt-5.4"]);
  });

  test("listCodexModels fetches account models with auth and client_version", async () => {
    const fetch = createMockFetch((url) => {
      expect(url).toContain("/models?");
      expect(url).toContain("client_version=");
      return jsonResponse({ models: [{ slug: "gpt-a" }, { slug: "gpt-b" }] });
    });
    const config = resolveConfig({ fetch });

    const models = await listCodexModels({
      config,
      getAuth: () => ({ accessToken: "at", accountId: "acct_1" }),
    });

    expect(models).toEqual(["gpt-a", "gpt-b"]);
    const headers = new Headers(fetch.calls[0]?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer at");
    expect(headers.get("chatgpt-account-id")).toBe("acct_1");
  });
});
