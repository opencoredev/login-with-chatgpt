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
| Realtime | `connectChatGPTRealtime`, `createChatGPTRealtimeCall`, session/event/action helpers |
| Storage | `KeyValueStore`, `MemoryStore` |
| Config/errors | `resolveConfig`, `ChatGPTConfig`, `ChatGPTAuthError` |

See the root README and docs site for production notes.

## Realtime voice

Browser applications can call `connectChatGPTRealtime()` after mounting the
server package's `/realtime` route. It creates a WebRTC peer, captures the
microphone, plays remote audio, decodes data-channel events, and enables local
voice-activity barge-in by default. The browser receives only an SDP answer;
ChatGPT credentials remain in the server handler.

See the [Realtime voice guide](../../docs/content/docs/guides/realtime-voice.mdx)
for session options, event names, client tools, and low-level primitives.
