import { describe, expect, test } from "bun:test";
import { ChatGPTImageError, ChatGPTProxyError, createChatGPT, createChatGPTProxyProvider } from "../src/index.ts";
import { createMockFetch, jsonResponse, makeAccessToken } from "../../core/test/helpers.ts";

describe("createChatGPT", () => {
  test("returns a callable provider with responses + openai accessors", () => {
    const chatgpt = createChatGPT({ credentials: { accessToken: "at", accountId: "acct_1" } });
    expect(typeof chatgpt).toBe("function");
    expect(typeof chatgpt.responses).toBe("function");
    expect(chatgpt.openai).toBeDefined();
    expect(chatgpt.images.generate).toBeFunction();
    expect(chatgpt.images.edit).toBeFunction();

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
    // A loader that returns access-only credentials must be called again
    // instead of reusing the expired access token.
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

  test("generates an image and reports streamed partial images", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetch = createMockFetch((_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer at");
      expect(headers.get("chatgpt-account-id")).toBe("acct_1");
      return sseResponse([
        {
          type: "response.image_generation_call.partial_image",
          partial_image_index: 1,
          partial_image_b64: "cGFydGlhbA==",
        },
        {
          type: "response.output_item.done",
          item: {
            type: "image_generation_call",
            id: "img_1",
            result: "ZmluYWw=",
            revised_prompt: "A revised prompt",
          },
        },
      ]);
    });
    const chatgpt = createChatGPT({
      credentials: { accessToken: "at", accountId: "acct_1" },
      fetch,
      defaultModel: "gpt-account-model",
    });
    const partials: string[] = [];

    const result = await chatgpt.images.generate({
      prompt: "A paper-cut forest",
      size: "2048x2048",
      quality: "high",
      format: "webp",
      compression: 70,
      background: "opaque",
      partialImages: 2,
      onPartialImage: (image) => {
        partials.push(image.dataUrl);
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      model: "gpt-account-model",
      input: "A paper-cut forest",
      stream: true,
      store: false,
      tool_choice: { type: "image_generation" },
      tools: [
        {
          type: "image_generation",
          action: "generate",
          size: "2048x2048",
          quality: "high",
          output_format: "webp",
          output_compression: 70,
          background: "opaque",
          partial_images: 2,
        },
      ],
    });
    expect(partials).toEqual(["data:image/webp;base64,cGFydGlhbA=="]);
    expect(result.data).toEqual([
      {
        base64: "ZmluYWw=",
        dataUrl: "data:image/webp;base64,ZmluYWw=",
        mediaType: "image/webp",
        format: "webp",
        id: "img_1",
        revisedPrompt: "A revised prompt",
      },
    ]);
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

  test("edits images with a mask and every output control through the proxy", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetch = createMockFetch((url, init) => {
      expect(url).toBe("https://app.example/api/chatgpt/responses");
      expect(init?.credentials).toBe("include");
      requestBody = JSON.parse(String(init?.body));
      return jsonResponse({
        output: [{ type: "image_generation_call", id: "img_edit", result: "ZWRpdGVk" }],
      });
    });
    const chatgpt = createChatGPTProxyProvider({
      basePath: "https://app.example/api/chatgpt",
      fetch,
      credentials: "include",
      headers: { "x-app": "test" },
    });

    const result = await chatgpt.images.edit({
      model: "gpt-image-capable",
      imageModel: "gpt-image-2",
      prompt: "Replace the sky and preserve everything else",
      images: [
        { data: "aW1hZ2U=", mediaType: "image/png", detail: "high" },
        { data: new Uint8Array([1, 2, 3]), mediaType: "image/jpeg" },
      ],
      mask: { data: "bWFzaw==", mediaType: "image/png" },
      inputFidelity: "high",
      size: "3840x2160",
      quality: "medium",
      format: "jpeg",
      compression: 55,
      background: "auto",
    });

    expect(requestBody).toMatchObject({
      model: "gpt-image-capable",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Replace the sky and preserve everything else" },
            { type: "input_image", image_url: "data:image/png;base64,aW1hZ2U=", detail: "high" },
            { type: "input_image", image_url: "data:image/jpeg;base64,AQID", detail: "auto" },
          ],
        },
      ],
      tools: [
        {
          type: "image_generation",
          action: "edit",
          model: "gpt-image-2",
          input_fidelity: "high",
          input_image_mask: { image_url: "data:image/png;base64,bWFzaw==" },
          size: "3840x2160",
          quality: "medium",
          output_format: "jpeg",
          output_compression: 55,
          background: "auto",
        },
      ],
    });
    expect(result.data[0]?.dataUrl).toBe("data:image/jpeg;base64,ZWRpdGVk");
  });

  test("generates multiple independent images from one prompt", async () => {
    let call = 0;
    const fetch = createMockFetch(() => {
      call += 1;
      return jsonResponse({
        output: [{ type: "image_generation_call", result: `aW1hZ2Ut${call}` }],
      });
    });
    const chatgpt = createChatGPTProxyProvider({ fetch });

    const result = await chatgpt.images.generate({ prompt: "Three variants", n: 3 });

    expect(fetch.calls).toHaveLength(3);
    expect(result.data.map((image) => image.base64)).toEqual(["aW1hZ2Ut1", "aW1hZ2Ut2", "aW1hZ2Ut3"]);
  });

  test("validates edit inputs and image controls", async () => {
    const chatgpt = createChatGPTProxyProvider({ fetch: createMockFetch(() => jsonResponse({})) });

    expect(() => chatgpt.images.edit({ prompt: "edit", images: [] })).toThrow("at least one source image");
    await expect(chatgpt.images.generate({ prompt: "image", compression: 101 })).rejects.toThrow("0 to 100");
    await expect(chatgpt.images.generate({ prompt: "image", size: "1000x1000" })).rejects.toThrow(
      "multiples of 16",
    );
  });

  test("surfaces upstream image errors with status and code", async () => {
    const fetch = createMockFetch(() =>
      jsonResponse({ error: { code: "image_generation_failed", message: "The image could not be generated." } }, 400),
    );
    const chatgpt = createChatGPTProxyProvider({ fetch });

    await expect(chatgpt.images.generate({ prompt: "image" })).rejects.toMatchObject({
      name: "ChatGPTImageError",
      status: 400,
      code: "image_generation_failed",
      message: "The image could not be generated.",
    } satisfies Partial<ChatGPTImageError>);
  });
});

function sseResponse(events: unknown[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}
