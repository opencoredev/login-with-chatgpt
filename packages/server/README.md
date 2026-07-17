# @opencoredev/loginwithchatgpt-server

Backend handler for [Login with ChatGPT](../../README.md).

It exposes login, status, session, logout, model discovery, responses proxy,
and Realtime WebRTC signaling routes from one Web-standard
`(Request) => Response` handler.

```ts
import { createChatGPTHandler } from "@opencoredev/loginwithchatgpt-server";

const auth = createChatGPTHandler({
  basePath: "/api/chatgpt",
  secret: process.env.LWC_SECRET,
  responsesProxy: {
    allowedModels: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"],
    maxRequestBytes: 40 * 1024 * 1024,
  },
  realtime: {
    // Resolve from an encrypted, user-bound ChatGPT web session. The normal
    // Codex login token is not accepted by GPT Live `/realtime/wm`.
    getAuth: async ({ request }) => getChatGPTLiveAuth(request),
    sessionDefaults: { transport: "wm", historyAndTrainingDisabled: false },
  },
});

Bun.serve({
  routes: {
    "/api/chatgpt/*": (req) => auth.handler(req),
  },
});
```

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/login` | Start or reuse a pending device-code login. |
| `GET` | `/status` | Advance one poll and return public status. |
| `GET` | `/session` | Return public status without polling. |
| `POST` | `/logout` | Delete the session and clear the cookie. |
| `GET` | `/models` | Return available model slugs for the signed-in account. |
| `POST` | `/responses` | Proxy an authenticated streaming responses request. |
| `POST` | `/realtime` | Exchange a browser WebRTC offer for a ChatGPT Realtime SDP answer. |

## Helpers

```ts
const session = await auth.getSession(request);
const models = await auth.getModels(request);
const proxyFetch = auth.proxyFetch(request);
```

## Security defaults

- Tokens are encrypted at rest (AES-GCM) when `secret` is configured, and the
  session cookie is HttpOnly and HMAC-signed.
- Normal app code uses `/responses`, `/models`, or `proxyFetch(request)`, so
  raw bearer tokens stay inside the handler.
- `/realtime` accepts only session options and SDP; it never returns OAuth
  material to the browser.
- GPT Live auth is supplied by `realtime.getAuth`; web-session credentials must
  remain encrypted, server-side, and bound to the application's user identity.
  Persist the stable device id and rotated session-cookie chunks returned by the
  core exchange helper, and serialize refreshes per user.
- Raw token export is disabled by default. `dangerouslyGetTokens()` requires
  `dangerouslyAllowTokenExport: true`; refresh-token export additionally
  requires `dangerouslyAllowRefreshTokenExport: true`.
- `/responses` is rate limited per session (30 requests/minute by default) via
  `responsesProxy.rateLimit`; requests through it spend the signed-in user's
  own ChatGPT plan.
- Cookie-authenticated non-GET routes reject cross-origin browser requests
  unless the origin is listed in `allowedOrigins`.

Production apps should set `secret` and provide a shared `sessionStore`.
They should also restrict the built-in proxy with
`responsesProxy.allowedModels` and `responsesProxy.maxRequestBytes` (or set
`enableResponsesProxy: false` and build a narrower proxy), and back
`responsesProxy.rateLimit` with a shared store when running multiple instances.
