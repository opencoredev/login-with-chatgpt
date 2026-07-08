import { describe, expect, test } from "bun:test";
import { ChatGPTProxyError, createChatGPT, createChatGPTProxyProvider } from "../src/index.ts";
import { createMockFetch, jsonResponse, makeAccessToken } from "../../core/test/helpers.ts";

describe("createChatGPT", () => {
  test("returns a callable provider with responses + openai accessors", () => {
    const chatgpt = createChatGPT({ credentials: { accessToken: "at", accountId: "acct_1" } });
    expect(typeof chatgpt).toBe("function");
    expect(typeof chatgpt.responses).toBe("function");
    expect(chatgpt.openai).toBeDefined();

    const model = chatgpt("gpt-5.3-codex-spark");
    expect(model).toBeObject();
    // AI SDK language models expose a specificationVersion.
    expect((model as { specificationVersion?: string }).specificationVersion).toBeString();
  });

  test("accepts a lazy credentials function and defaults the model", () => {
    const chatgpt = createChatGPT({ credentials: () => ({ accessToken: "at", accountId: "a" }) });
    const model = chatgpt(); // no model id -> default
    expect((model as { modelId?: string }).modelId).toBe("gpt-5.5");
  });

  test("reloads function credentials when an unrefreshable access token expires", async () => {
    // Refresh-token-less credentials are what the server handler's redacted
    // getTokens() returns; the provider must go back to the source instead of
    // reusing the expired access token.
    let loads = 0;
    const fetch = createMockFetch(() => jsonResponse({ models: [{ slug: "gpt-a" }] }));
    const chatgpt = createChatGPT({
      credentials: () => {
        loads += 1;
        return {
          accessToken: makeAccessToken(loads === 1 ? -3600 : 3600),
          accountId: "acct_1",
        };
      },
      fetch,
    });

    await chatgpt.listModels();
    expect(loads).toBe(1); // first load is trusted as-is
    await chatgpt.listModels();
    expect(loads).toBe(2); // expired + no refresh token -> reloaded
    await chatgpt.listModels();
    expect(loads).toBe(2); // fresh token -> no reload
  });

  test("lists account models", async () => {
    const fetch = createMockFetch(() => jsonResponse({ models: [{ slug: "gpt-a" }, { slug: "gpt-b" }] }));
    const chatgpt = createChatGPT({
      credentials: { accessToken: "at", accountId: "acct_1" },
      fetch,
    });

    expect(await chatgpt.listModels()).toEqual(["gpt-a", "gpt-b"]);
    expect(fetch.calls[0]?.url).toContain("/models?");
  });
});

describe("createChatGPTProxyProvider", () => {
  test("builds a provider pointing at the backend proxy path", () => {
    const chatgpt = createChatGPTProxyProvider({ basePath: "/api/chatgpt" });
    expect(typeof chatgpt).toBe("function");
    expect(chatgpt("gpt-5.3-codex-spark")).toBeObject();
  });

  test("lists models through the backend proxy", async () => {
    const fetch = createMockFetch((url, init) => {
      expect(url).toBe("/api/chatgpt/models");
      expect(init?.credentials).toBe("same-origin");
      return jsonResponse({ models: [{ slug: "gpt-proxy" }] });
    });
    const chatgpt = createChatGPTProxyProvider({ basePath: "/api/chatgpt", fetch });

    expect(await chatgpt.listModels()).toEqual(["gpt-proxy"]);
  });

  test("surfaces model-list response status", async () => {
    const fetch = createMockFetch(() => jsonResponse({ error: "not_authenticated" }, 401));
    const chatgpt = createChatGPTProxyProvider({ basePath: "/api/chatgpt", fetch });

    await expect(chatgpt.listModels()).rejects.toMatchObject({
      name: "ChatGPTProxyError",
      status: 401,
    } satisfies Partial<ChatGPTProxyError>);
  });
});
