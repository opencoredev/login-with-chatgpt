# Login with ChatGPT

TypeScript packages for adding ChatGPT account login to an app, then streaming
responses through the signed-in user's session.

The server keeps tokens private. The browser gets an HttpOnly session cookie,
discovers the account's available models through your backend, and can use the
Vercel AI SDK without seeing an access token.

> Compatibility note: this SDK uses the public Codex OAuth client and
> ChatGPT-backed Codex endpoints. Those endpoints are not the official,
> versioned OpenAI Platform API. Keep the client version and endpoints
> configurable, and smoke test login, model listing, and streaming before
> shipping.

## Packages

| Package | Job |
| --- | --- |
| `@loginwithchatgpt/core` | Device-code OAuth, PKCE helpers, token refresh, JWT parsing, Codex transport normalization, and model discovery. |
| `@loginwithchatgpt/server` | A Web-standard handler for login, status, session, logout, models, and responses proxying. |
| `@loginwithchatgpt/react` | `useLoginWithChatGPT()` and a styled `<LoginWithChatGPT />` widget. |
| `@loginwithchatgpt/ai` | Vercel AI SDK providers for browser proxy mode and direct server-token mode. |

## Quickstart

```bash
bun add @loginwithchatgpt/server @loginwithchatgpt/react @loginwithchatgpt/ai
bun add ai @ai-sdk/openai
# or: npm install / pnpm add — the packages ship compiled ESM + types for Node 18+
```

Mount the backend handler:

```ts
import { createChatGPTHandler } from "@loginwithchatgpt/server";
import index from "./index.html";

const auth = createChatGPTHandler({
  secret: process.env.LWC_SECRET,
  responsesProxy: {
    allowedModels: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"],
    maxRequestBytes: 8 * 1024 * 1024,
  },
});

Bun.serve({
  routes: {
    "/": index,
    "/api/chatgpt/*": (req) => auth.handler(req),
  },
});
```

Render the button:

```tsx
"use client";

import { LoginWithChatGPT } from "@loginwithchatgpt/react";

export function SignIn() {
  return (
    <LoginWithChatGPT
      basePath="/api/chatgpt"
      consent={{ appName: "Acme" }}
    />
  );
}
```

The default widget always opens a consent popup first — it warns the user that
requests bill to their own ChatGPT plan, and it cannot be disabled (only
customized via `consent={{ appName, securityHref }}`). If the popup is blocked,
the same consent renders inline. If the user continues, the popup navigates to
OpenAI's verification page. Custom UIs built on the hook must render equivalent
consent themselves.

Use the browser-safe AI SDK proxy:

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
  prompt: "Explain HTTP cookies in one paragraph.",
});

for await (const delta of result.textStream) {
  process.stdout.write(delta);
}
```

## Server helpers

```ts
const session = await auth.getSession(request);
const tokens = await auth.getTokens(request);
const models = await auth.getModels(request);
```

Use `getTokens()` for direct server-side AI SDK calls:

```ts
import { createChatGPT } from "@loginwithchatgpt/ai";

const tokens = await auth.getTokens(request);
if (!tokens) return new Response("Unauthorized", { status: 401 });

const chatgpt = createChatGPT({ credentials: tokens });
```

`getTokens()` returns only the short-lived access token — the refresh token
stays inside the handler's session layer, so app code never holds a credential
that can mint new tokens indefinitely. Pass `{ includeRefreshToken: true }`
only if you truly need to export a session.

## Built-in protections

Signing in with ChatGPT hands an app real spending power over the user's plan,
so the server handler defends the user by default:

- Tokens never reach the browser; the session cookie is HttpOnly and signed,
  and tokens are AES-GCM encrypted at rest.
- The refresh token is never exposed to app code unless explicitly requested.
- The `/responses` proxy rate limits each session (30 requests/minute default,
  tune via `responsesProxy.rateLimit`) so client code can't silently burn a
  user's plan.
- Cookie-authenticated non-GET routes reject cross-origin browser requests
  unless allowlisted via `allowedOrigins` — no CSRF cookie-riding, even with
  `SameSite=None`.
- The default widget always shows a usage-risk consent step before OpenAI's
  verification page; it can be customized but not disabled.
- The OAuth session is scoped by OpenAI to the Codex API: it can spend plan
  usage but cannot sign in to chatgpt.com as the user, read their
  conversations, or change account settings.

## Production checklist

- Set a stable `LWC_SECRET`.
- Use a shared `sessionStore` outside local development.
- Keep tokens server-side.
- If you build a custom login UI, render consent equivalent to the built-in
  popup before calling `login()`.
- Restrict the built-in responses proxy with `responsesProxy.allowedModels` and
  `responsesProxy.maxRequestBytes`, and review the default per-session
  `responsesProxy.rateLimit` (back it with a shared store across instances).
- Use `chatgpt.listModels()` or `auth.getModels(request)` instead of hardcoding a long model list.
- Configure cookies and CORS explicitly for cross-origin frontend/backend
  setups, and list your frontend in `allowedOrigins`.
- Rate limit `/login` and `/status` at the edge (WAF/CDN/gateway). They are
  unauthenticated by design, so the handler can't rate limit them itself.
- Review OpenAI terms and policy for your use case.

## Demo

```bash
bun install
bun run demo
```

The demo mounts the server handler at `/api/chatgpt/*`, renders the React sign-in
flow, discovers models with `chatgpt.listModels()`, and streams a response.

## Runtime support

Every package is dual-published: Node (and any bundler) consumes compiled ESM
plus type declarations from `dist/`, while Bun consumes the TypeScript source
directly through the `bun` export condition — no build step needed in Bun
projects or in this repo.

## Development

```bash
bun run typecheck
bun test packages
bun run build   # emit dist/ for all packages (runs automatically on publish)
```

Docs live in `docs/` and are intentionally outside the root Bun workspace.

## License

MIT
