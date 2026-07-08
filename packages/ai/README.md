# @loginwithchatgpt/ai

Vercel AI SDK provider for [Login with ChatGPT](../../README.md).

Use `createChatGPTProxyProvider()` in the browser and `createChatGPT()` on the
server.

## Browser proxy mode

```ts
import { createChatGPTProxyProvider } from "@loginwithchatgpt/ai";
import { streamText } from "ai";

const chatgpt = createChatGPTProxyProvider({ basePath: "/api/chatgpt" });
const models = await chatgpt.listModels();
const model = models.includes("gpt-5.5")
  ? "gpt-5.5"
  : models[0];

if (!model) throw new Error("No ChatGPT models were returned for this account.");

const result = streamText({
  model: chatgpt(model),
  prompt,
});
```

The proxy provider sends requests to your server handler. Tokens stay server-side.

## Server token mode

```ts
import { createChatGPT } from "@loginwithchatgpt/ai";
import { streamText } from "ai";

const chatgpt = createChatGPT({
  credentials: tokens,
  onRefresh: saveTokens,
});

const models = await chatgpt.listModels();
const model = models.includes("gpt-5.5")
  ? "gpt-5.5"
  : models[0];

if (!model) throw new Error("No ChatGPT models were returned for this account.");

const result = streamText({
  model: chatgpt(model),
  prompt,
});
```

To request Codex Fast tier through the browser proxy, pass the SDK header:

```ts
const result = streamText({
  model: chatgpt("gpt-5.5"),
  prompt,
  headers: {
    "x-login-with-chatgpt-service-tier": "fast",
  },
});
```

## Provider shape

```ts
chatgpt(modelId);
chatgpt.responses(modelId);
await chatgpt.listModels();
chatgpt.openai;
```

Peer dependencies: `ai@^7` and `@ai-sdk/openai@^4`.
