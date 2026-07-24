# @opencoredev/loginwithchatgpt-core

Framework-agnostic engine for [Login with ChatGPT](../../README.md).

Use this package directly when you are building a custom backend, CLI, storage
adapter, or transport. Most apps should start with `@opencoredev/loginwithchatgpt-server`.

```ts
import {
  listCodexModels,
  requestDeviceCode,
  resolveConfig,
  waitForDeviceTokens,
} from "@opencoredev/loginwithchatgpt-core";

const config = resolveConfig();
const device = await requestDeviceCode(config);

console.log(`Open ${device.verificationUrl} and enter ${device.userCode}`);

const tokens = await waitForDeviceTokens(config, device);
if (!tokens.accountId) throw new Error("Missing ChatGPT account id.");

const models = await listCodexModels({
  config,
  getAuth: () => ({
    accessToken: tokens.accessToken,
    accountId: tokens.accountId,
  }),
});
```

## Main exports

| Area | Exports |
| --- | --- |
| Device flow | `requestDeviceCode`, `pollDeviceCode`, `waitForDeviceTokens`, `exchangeDeviceAuthorization` |
| PKCE flow | `createAuthorizationUrl`, `exchangeAuthorizationCode`, `generatePkce`, `createState` |
| Tokens | `ensureFreshTokens`, `isAccessTokenExpired`, `refreshTokens` |
| Identity | `parseUser`, `deriveAccountId`, `decodeJwt`, `getTokenExpiry` |
| Transport | `createCodexFetch`, `normalizeResponsesBody`, `listCodexModels`, `extractCodexModelSlugs` |
| Experimental voice | `connectChatGPTRealtime`, `connectChatGPTRealtimeAppServer`, `createChatGPTRealtimeCall`, app-server and event helpers |
| Storage | `KeyValueStore`, `MemoryStore` |
| Config/errors | `resolveConfig`, `ChatGPTConfig`, `ChatGPTAuthError` |

See the root README and docs site for production notes.

## Experimental private voice transport

Browser applications can call `connectChatGPTRealtime()` after mounting the
server package's `/realtime` route. It creates a WebRTC peer, captures the
microphone, plays remote audio, decodes data-channel events, and enables local
voice-activity barge-in by default. The browser receives only an SDP answer;
ChatGPT credentials remain in the server handler.

`/wm` reserves `client_tools` for ChatGPT's first-party device integrations and
rejects arbitrary application IDs. Direct browser `/wm` sessions therefore
remain voice-only and do not expose the desktop app-server's thread-scoped
handoff protocol. Do not infer actions from caption or transcript events.

For native audio plus application tools, configure the server package's
`realtime.appServer` policy and call
`connectChatGPTRealtimeAppServer()`. The browser helper keeps the same WebRTC
audio and interruption behavior while subscribing to server-owned handoff,
tool, pending-confirmation, and cleanup routes. Arbitrary schemas and execution
remain on the server.

Direct GPT Live `/wm` requires a separate ChatGPT web-client credential; the Codex
device-login token does not authorize it. Keep that session encrypted and
server-side, mint short-lived auth with `exchangeChatGPTRealtimeWebSession()`,
persist its returned stable device id and rotated cookie chunks, and provide the
result through the server package's `realtime.getAuth` callback.

The desktop-style app-server path is different: it uses the authenticated
Codex session already managed by the server package and requires a Node/Bun
backend with the `codex` executable available.

See the [experimental voice guide](../../docs/content/docs/guides/realtime-voice.mdx)
for both connection paths, schemas, event names, confirmations, and low-level
primitives.
