---
name: login-with-chatgpt
description: >-
  Integrate Login with ChatGPT (@opencoredev/loginwithchatgpt-*): let users
  sign in with their own ChatGPT account and run AI requests against their
  ChatGPT plan. Use when adding ChatGPT account login, mounting
  createChatGPTHandler, rendering the LoginWithChatGPT React button or
  useLoginWithChatGPT hook, wiring createChatGPTProxyProvider /
  createChatGPT with the Vercel AI SDK, or debugging /api/chatgpt routes.
license: MIT
---

# Login with ChatGPT

SDK for "sign in with your ChatGPT account". Users authenticate through
OpenAI's device flow; your handler keeps the tokens and proxies
Responses-style calls to the ChatGPT-backed Codex endpoint.
The browser only ever holds an HttpOnly session cookie.

## Rules: read before writing code

1. **There is no API key.** Auth comes from each user's ChatGPT session.
   Never add `OPENAI_API_KEY`, never call `api.openai.com` directly for this
   flow. Requests go through the app's own `/api/chatgpt/responses` proxy or
   a server route built on `auth.proxyFetch(request)`.
2. **Discover before selecting a model.** Availability is per account and
   plan. Call `await chatgpt.listModels()` (browser) or
   `await auth.getModels(request)` (server), then pick from that result.
   A hardcoded `allowedModels` guardrail is fine; assuming one model exists
   for every signed-in account is not.
3. **Tokens stay inside the handler by default.** Don't build endpoints that
   return tokens to the client. Normal app code should use `/responses`,
   `/models`, or `auth.proxyFetch(request)`. Raw token export requires the
   explicit `dangerouslyAllowTokenExport` escape hatch.
4. **Consent cannot be removed.** The widget always shows a consent step
   before OpenAI's verification page. Custom UIs must render equivalent
   consent before calling `login()`.
5. **Production needs a stable `secret` and a shared `sessionStore`.** The
   defaults (ephemeral secret, in-memory store) log everyone out on restart
   and break across serverless instances.

## Packages

| Package | Use for |
| --- | --- |
| `@opencoredev/loginwithchatgpt-server` | `createChatGPTHandler()` for login, session, logout, models, and the streaming proxy |
| `@opencoredev/loginwithchatgpt-react` | `<LoginWithChatGPT />` button, `useLoginWithChatGPT()` hook |
| `@opencoredev/loginwithchatgpt-ai` | Vercel AI SDK providers (`ai` + `@ai-sdk/openai` are peer deps) |
| `@opencoredev/loginwithchatgpt-core` | Low-level OAuth/device flow, errors, and types; rarely imported directly |

```bash
bun add @opencoredev/loginwithchatgpt-server @opencoredev/loginwithchatgpt-react @opencoredev/loginwithchatgpt-ai ai @ai-sdk/openai
```

## Server handler

One handler owns everything under `basePath` (default `/api/chatgpt`). It is
written against Web-standard `Request`, `Response`, `fetch`, and
`crypto.subtle`, so use it in runtimes that provide those APIs.

```ts
// Next.js: app/api/chatgpt/[...lwc]/route.ts
import { createChatGPTHandler } from "@opencoredev/loginwithchatgpt-server";

const auth = createChatGPTHandler({
  secret: process.env.LWC_SECRET, // openssl rand -hex 32
  responsesProxy: {
    allowedModels: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"],
  },
});

export const GET = (request: Request) => auth.handler(request);
export const POST = (request: Request) => auth.handler(request);
```

```ts
// Bun
Bun.serve({
  routes: {
    "/": index,
    "/api/chatgpt/*": (req) => auth.handler(req),
  },
});
```

Key options: `basePath`, `secret`, `sessionStore` (any
`get`/`set`/`delete` key-value store), `cookieName`, `cookie`,
`sessionTtlMs` (30 days), `defaultModel` (`"gpt-5.5"`),
`enableResponsesProxy` (`false` also disables `/models`), `responsesProxy`
(`allowedModels`, `maxRequestBytes` 40 MiB, `rateLimit` default
30/min/session), `allowedOrigins` (cross-origin CSRF allowlist).

Server helpers on the returned handler (all read the session cookie):

- `auth.getSession(request)` → `{ status, user? }`; no upstream call.
- `auth.proxyFetch(request)` → request-scoped fetch for custom server AI
  routes without exposing raw bearer tokens.
- `auth.getModels(request)` → account's model slugs or `undefined`.
- `auth.dangerouslyGetTokens(request)` → raw-token escape hatch; requires
  `dangerouslyAllowTokenExport`.

## React sign-in

```tsx
"use client";
import { LoginWithChatGPT } from "@opencoredev/loginwithchatgpt-react";

<LoginWithChatGPT
  consent={{ appName: "Acme" }}
  onAuthenticated={(user) => console.log("connected", user?.email)}
/>;
```

The widget handles the full flow: consent popup → OpenAI verification →
code copy → polling → signed-in chip with Disconnect. Restyle via the
injected `.lwc-*` classes, or pass a `children` render function for a fully
custom UI (then render your own consent and use
`openLoginWithChatGPTConsentPopup()`).

For custom UIs, `useLoginWithChatGPT({ basePath?, pollIntervalMs?, ... })`
returns `{ status, user, userCode, verificationUrl, login, logout,
copyCode, reopen, isAuthenticated, isPending }`. `status` is one of
`loading | unauthenticated | connecting | pending | authenticated |
expired | error`.

## Streaming with the AI SDK

Browser proxy provider, with credentials injected server-side from the cookie:

```ts
import { createChatGPTProxyProvider } from "@opencoredev/loginwithchatgpt-ai";
import { streamText } from "ai";

const chatgpt = createChatGPTProxyProvider(); // { basePath } if not /api/chatgpt

const models = await chatgpt.listModels(); // throws ChatGPTProxyError; status 401 = signed out
const model = models.includes("gpt-5.5") ? "gpt-5.5" : models[0];

const result = streamText({ model: chatgpt(model), prompt });
```

Server proxy provider for your own AI route:

```ts
import { createChatGPTProxyProvider } from "@opencoredev/loginwithchatgpt-ai";
import { streamText } from "ai";

export async function POST(request: Request) {
  const chatgpt = createChatGPTProxyProvider({
    fetch: auth.proxyFetch(request),
  });
  const { prompt } = await request.json();
  return streamText({ model: chatgpt(), prompt }).toUIMessageStreamResponse();
}
```

Models support `streamText`, `generateText`, tool calling, structured
output, and file attachments via standard AI SDK `messages`. Images are a
first-class provider API: use `chatgpt.images.generate()` for prompt-to-image
and `chatgpt.images.edit()` for edits, multiple references, masks, input
fidelity, custom size, quality, format, compression, background, multiple
outputs, and partial-image callbacks. Both use the signed-in user's ChatGPT
plan through `/responses`; do not add an API key. Embeddings and audio are not
provided.

Per-request tuning headers on `POST /responses`:
`x-login-with-chatgpt-reasoning-effort` (`none|low|medium|high|xhigh`) and
`x-login-with-chatgpt-service-tier` (`auto|default|flex|priority|fast`).

## HTTP routes (relative to basePath)

| Route | Purpose |
| --- | --- |
| `POST /login` | Start device login → `{ status: "pending", userCode, verificationUrl, interval, expiresAt }` |
| `GET /status` | Advance login by one poll, return state |
| `GET /session` | Cheap state read, never polls upstream |
| `POST /logout` | Delete session, clear cookie |
| `GET /models` | Account's model slugs (401 when signed out) |
| `POST /responses` | Streaming Responses-style proxy |

Non-GET routes enforce Origin-based CSRF: same-origin or `allowedOrigins`
only. Split frontend/backend deployments also need `SameSite=None` cookies,
credentialed fetches, and CORS headers (see the cross-origin guide).

## Production checklist

- Set `LWC_SECRET` (stable across deploys; rotation logs everyone out).
- Use a shared `sessionStore` (Redis/DB). `MemoryStore` is dev-only.
- Set `responsesProxy.allowedModels`; pass a shared `rateLimit.store` when
  running multiple instances.
- HTTPS with `X-Forwarded-Proto` forwarded so the cookie gets `Secure`.
- Log `/responses` metadata (session id, model, status, duration), never
  prompts or attachments.

## Errors

`ChatGPTAuthError` (from core) has `.code`, `.status`, `.body`. Notable
codes: `refresh_token_invalid` (session dead; handler deletes it and
reports `expired`; detect with `isRefreshTokenInvalid(error)`),
`not_authenticated`, `token_refresh_failed` (retryable),
`models_request_failed`. The browser provider's `listModels()` throws
`ChatGPTProxyError` with `.status`. HTTP errors from `/responses`:
`401 not_authenticated`, `403 model_not_allowed` / `origin_not_allowed`,
`413 responses_request_too_large`, `429 rate_limited` (+ `retry-after`).

## Docs

Full docs live in the repo under `docs/content/docs/` (quickstart,
concepts/security, guides/production, reference/*). The docs site also
serves `/llms.txt` and per-page markdown at
`/llms.mdx/docs/<path>/content.md`.
