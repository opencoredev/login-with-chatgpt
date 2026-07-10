import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import {
  type ChatGPTConfig,
  type ChatGPTTokens,
  type CodexAuth,
  type CodexResponsesOptions,
  ChatGPTAuthError,
  DEFAULT_MODEL,
  createCodexFetch,
  ensureFreshTokens,
  isAccessTokenExpired,
  listCodexModels,
  resolveConfig,
} from "@opencoredev/loginwithchatgpt-core";
import { createChatGPTImagesClient, type ChatGPTImagesClient } from "./images.ts";

/** A responses-API model created by a {@link ChatGPTProvider}. */
export type ChatGPTLanguageModel = ReturnType<OpenAIProvider["responses"]>;

/**
 * Callable provider. `chatgpt(modelId)` and `chatgpt.responses(modelId)` both
 * return a Codex responses model that uses the signed-in user's ChatGPT plan.
 */
export interface ChatGPTProvider {
  (modelId?: string): ChatGPTLanguageModel;
  responses(modelId?: string): ChatGPTLanguageModel;
  /** The underlying `@ai-sdk/openai` provider, if you need other model types. */
  readonly openai: OpenAIProvider;
  /** Lists model slugs available to the signed-in ChatGPT account. */
  listModels(): Promise<string[]>;
  /** Generates and edits images through the signed-in user's ChatGPT plan. */
  readonly images: ChatGPTImagesClient;
}

export interface CreateChatGPTOptions extends ChatGPTConfig, CodexResponsesOptions {
  /**
   * The user's tokens, or a function returning them (e.g. read from your
   * session store per request). Refresh is handled automatically.
   */
  credentials: ChatGPTTokens | (() => ChatGPTTokens | Promise<ChatGPTTokens>);
  /** Persist refreshed tokens back to your store. */
  onRefresh?: (tokens: ChatGPTTokens) => void | Promise<void>;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
  /** Default model id when none is passed to the provider. */
  defaultModel?: string;
}

/**
 * Creates a Vercel AI SDK provider that runs the OpenAI **responses** API on the
 * user's own ChatGPT plan. Use it with `streamText`/`generateText` exactly like
 * any other provider:
 *
 * ```ts
 * const chatgpt = createChatGPT({ credentials: userTokens, onRefresh: save });
 * const models = await chatgpt.listModels();
 * const model = models.includes("gpt-5.5") ? "gpt-5.5" : models[0];
 * if (!model) throw new Error("No ChatGPT models were returned.");
 * const result = streamText({ model: chatgpt(model), prompt: "Hi" });
 * ```
 *
 * Intended for server-side use where you hold the user's tokens. For the
 * browser, point the AI SDK at your backend proxy with
 * {@link createChatGPTProxyProvider} instead.
 */
export function createChatGPT(options: CreateChatGPTOptions): ChatGPTProvider {
  const config = resolveConfig(options);
  const defaultModel = options.defaultModel ?? DEFAULT_MODEL;
  const credentials = options.credentials;
  const loadCredentials = typeof credentials === "function" ? credentials : () => credentials;

  let current: ChatGPTTokens | undefined;

  const getAuth = async (): Promise<CodexAuth> => {
    // Credentials without a refresh token cannot be refreshed here. Re-ask the
    // credentials function for a fresh access token when the current one
    // expires.
    if (
      !current ||
      (typeof credentials === "function" && !current.refreshToken && isAccessTokenExpired(current))
    ) {
      current = await loadCredentials();
    }
    const fresh = await ensureFreshTokens(config, current, {
      onRefresh: async (tokens) => {
        current = tokens;
        await options.onRefresh?.(tokens);
      },
    });
    current = fresh;
    if (!fresh.accountId) {
      throw new ChatGPTAuthError("invalid_token", "ChatGPT tokens are missing an account id; sign in again.");
    }
    return { accessToken: fresh.accessToken, accountId: fresh.accountId };
  };

  const codexFetch = createCodexFetch({
    config,
    getAuth,
    headers: options.headers,
    instructions: options.instructions,
    reasoningEffort: options.reasoningEffort,
    reasoningSummary: options.reasoningSummary,
    textVerbosity: options.textVerbosity,
    serviceTier: options.serviceTier,
  });

  const openai = createOpenAI({
    baseURL: config.codexBaseUrl,
    apiKey: "login-with-chatgpt", // placeholder; real auth is injected by the fetch
    fetch: codexFetch,
  });

  const images = createChatGPTImagesClient({
    fetch: codexFetch,
    responsesUrl: `${config.codexBaseUrl}/responses`,
    defaultModel,
  });

  const provider = ((modelId?: string) => openai.responses(modelId ?? defaultModel)) as ChatGPTProvider;
  Object.defineProperties(provider, {
    responses: { value: (modelId?: string) => openai.responses(modelId ?? defaultModel), enumerable: true },
    openai: { value: openai, enumerable: true },
    images: { value: images, enumerable: true },
    listModels: {
      value: () => listCodexModels({ config, getAuth, headers: options.headers }),
      enumerable: true,
    },
  });
  return provider;
}
