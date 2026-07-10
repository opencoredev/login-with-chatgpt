import { createOpenAI } from "@ai-sdk/openai";
import { DEFAULT_MODEL, extractCodexModelSlugs, type FetchLike } from "@opencoredev/loginwithchatgpt-core";
import type { ChatGPTProvider } from "./provider.ts";
import { createChatGPTImagesClient } from "./images.ts";

export interface CreateChatGPTProxyOptions {
  /**
   * Base path of your mounted server handler. The provider appends `/responses`
   * to it. Defaults to `/api/chatgpt`. May be relative (browser, same-origin)
   * or absolute.
   */
  basePath?: string;
  /** Custom fetch (e.g. to add `credentials: "include"` for cross-origin). */
  fetch?: FetchLike;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
  /** Credentials mode for `listModels()` and `images.*()` requests. Defaults to same-origin. */
  credentials?: RequestCredentials;
  /** Default model id when none is passed to the provider. */
  defaultModel?: string;
}

export class ChatGPTProxyError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ChatGPTProxyError";
    this.status = status;
  }
}

/**
 * Creates an AI SDK provider that talks to your Login with ChatGPT backend
 * proxy instead of holding tokens directly. The backend injects the user's
 * credentials from their session cookie, so this is safe to use in the browser:
 *
 * ```ts
 * const chatgpt = createChatGPTProxyProvider(); // -> POST /api/chatgpt/responses
 * const models = await chatgpt.listModels();
 * const model = models.includes("gpt-5.5") ? "gpt-5.5" : models[0];
 * if (!model) throw new Error("No ChatGPT models were returned.");
 * const result = streamText({ model: chatgpt(model), prompt });
 * ```
 */
export function createChatGPTProxyProvider(options: CreateChatGPTProxyOptions = {}): ChatGPTProvider {
  const basePath = (options.basePath ?? "/api/chatgpt").replace(/\/+$/, "");
  const defaultModel = options.defaultModel ?? DEFAULT_MODEL;
  const doFetch = options.fetch ?? globalThis.fetch;

  const openai = createOpenAI({
    baseURL: basePath,
    apiKey: "login-with-chatgpt-proxy", // ignored by the proxy, which uses the session cookie
    fetch: options.fetch,
    headers: options.headers,
  });

  const images = createChatGPTImagesClient({
    fetch: doFetch,
    responsesUrl: `${basePath}/responses`,
    defaultModel,
    headers: options.headers,
    credentials: options.credentials ?? "same-origin",
  });

  const provider = ((modelId?: string) => openai.responses(modelId ?? defaultModel)) as ChatGPTProvider;
  Object.defineProperties(provider, {
    responses: { value: (modelId?: string) => openai.responses(modelId ?? defaultModel), enumerable: true },
    openai: { value: openai, enumerable: true },
    images: { value: images, enumerable: true },
    listModels: {
      value: async () => {
        const response = await doFetch(`${basePath}/models`, {
          method: "GET",
          credentials: options.credentials ?? "same-origin",
          headers: { accept: "application/json", ...options.headers },
        });
        if (!response.ok) {
          throw new ChatGPTProxyError(`Model list request failed (${response.status}).`, response.status);
        }
        return extractCodexModelSlugs(await response.json());
      },
      enumerable: true,
    },
  });
  return provider;
}
