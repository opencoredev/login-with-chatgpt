/**
 * @loginwithchatgpt/ai
 *
 * A Vercel AI SDK provider for the ChatGPT-backed Codex responses API. Models
 * run on the signed-in user's own ChatGPT plan, so usage is billed to them —
 * not to you. Works with `streamText`, `generateText`, tools, and structured
 * output like any other AI SDK provider.
 */

export {
  createChatGPT,
  type CreateChatGPTOptions,
  type ChatGPTProvider,
  type ChatGPTLanguageModel,
} from "./provider.ts";
export { ChatGPTProxyError, createChatGPTProxyProvider, type CreateChatGPTProxyOptions } from "./proxy.ts";
export { type ChatGPTTokens, type ChatGPTConfig } from "@loginwithchatgpt/core";
