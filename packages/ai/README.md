# @opencoredev/loginwithchatgpt-ai

Vercel AI SDK provider for [Login with ChatGPT](../../README.md).

Use `createChatGPTProxyProvider()` in browsers and app-server routes.
`createChatGPT()` is for headless/server-only flows where you intentionally
manage token custody yourself.

## Browser proxy mode

```ts
import { createChatGPTProxyProvider } from "@opencoredev/loginwithchatgpt-ai";
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

The proxy provider sends requests to your server handler. In browser code it
uses the session cookie; in server routes, pass `auth.proxyFetch(request)` so
tokens stay inside the handler:

```ts
const chatgpt = createChatGPTProxyProvider({
  fetch: auth.proxyFetch(request),
});
```

## Direct token mode

```ts
import { createChatGPT } from "@opencoredev/loginwithchatgpt-ai";
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

Direct token mode is an escape hatch for CLIs, headless apps, or migrations.
Normal web apps should keep using the proxy provider.

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
await chatgpt.images.generate({ prompt, model: modelId });
await chatgpt.images.edit({ prompt, images, model: modelId });
chatgpt.openai;
```

## Image generation

Image generation uses the signed-in user's ChatGPT plan through the same
`/responses` proxy. Discover a model from the account before making the request:

```ts
const models = await chatgpt.listModels();
const model = models[0];
if (!model) throw new Error("No ChatGPT models were returned for this account.");

const result = await chatgpt.images.generate({
  model,
  prompt: "A product photograph of a translucent orange desk lamp on limestone",
  size: "2048x2048",
  quality: "high",
  format: "webp",
  compression: 80,
  background: "opaque",
  n: 2,
  partialImages: 2,
  onPartialImage(partial) {
    preview.src = partial.dataUrl;
  },
});

for (const image of result.data) {
  console.log(image.base64, image.dataUrl, image.mediaType);
}
```

`size` accepts `auto` or custom dimensions such as `1024x1024`,
`2048x1152`, and `3840x2160`. Custom dimensions are validated against GPT
Image's current edge, aspect-ratio, and pixel-count constraints.

## Image editing

`images.edit()` forces an edit and resends the source images with the request,
so it works with the stateless ChatGPT-backed Responses transport. Inputs can
be remote URLs, data URLs, raw base64, `Blob`, `ArrayBuffer`, or `Uint8Array`:

```ts
const edited = await chatgpt.images.edit({
  model,
  prompt: "Replace the sky with a soft sunset. Preserve the product exactly.",
  images: [
    {
      data: sourceFile, // Blob
      detail: "high",
    },
  ],
  mask: {
    data: maskBytes,
    mediaType: "image/png",
  },
  inputFidelity: "high",
  size: "1536x1024",
  quality: "high",
  format: "png",
});

imageElement.src = edited.data[0].dataUrl;
```

The common controls are `model`, `imageModel`, `size`, `quality`, `format`,
`compression`, `background`, `n`, `partialImages`, `onPartialImage`, and
`signal`. Editing additionally supports multiple `images`, `mask`, and
`inputFidelity`. Some combinations remain model-dependent—for example, the
selected image model may reject transparent backgrounds.

Peer dependencies: `ai@^7` and `@ai-sdk/openai@^4`.
