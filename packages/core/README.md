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
| Storage | `KeyValueStore`, `MemoryStore` |
| Config/errors | `resolveConfig`, `ChatGPTConfig`, `ChatGPTAuthError` |

See the root README and docs site for production notes.
