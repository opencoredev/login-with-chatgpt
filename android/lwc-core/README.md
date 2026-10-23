# lwc-core

Pure-Kotlin/JVM engine for **Login with ChatGPT** on Android — a port of the
TypeScript `@opencoredev/loginwithchatgpt-core` package. No Android dependencies,
so it runs on the JVM (and is unit-testable without a device). The `lwc-android`
module layers Keystore-backed token storage and a Custom Tab launcher on top.

It lets an app sign a user in with **their own** ChatGPT subscription (Free/Plus/Pro)
via OpenAI's device-code OAuth flow, then call Codex models billed to that user —
the developer supplies no OpenAI API key.

## What it does

- **Device login** — `requestDeviceCode` → show the code → `pollDeviceCode` /
  `waitForDeviceTokens` → tokens. No redirect URI or localhost listener needed,
  which is what makes it work on mobile.
- **Token lifecycle** — `ensureFreshTokens` refreshes on expiry; `parseUser`
  reads the public profile (email, name, plan) from the id token.
- **Model calls** — `codexResponses(...)` returns a `Flow<String>` of streamed
  assistant text; `listCodexModels(...)` returns the account's available models.

## Quick start (JVM)

```kotlin
val config = resolveConfig()                 // Codex defaults; every field overridable
val device = requestDeviceCode(config)
println("Open ${device.verificationUrl} and enter ${device.userCode}")
val tokens = waitForDeviceTokens(config, device)   // blocks until authorized

val auth = CodexAuth(tokens.accessToken, tokens.accountId!!)
codexResponses(config, getAuth = { auth }, body = buildJsonObject {
    put("model", "gpt-5.5")
    put("input", "Say hello.")
}).collect { print(it) }
```

Run the end-to-end spike against a real account:

```bash
gradle :lwc-core:run --args="Say hello in one short sentence."
```

## Security / trust boundary

Unlike the web SDK — where tokens stay on a server behind a proxy — this is an
**on-device** design. The user's `accessToken`/`refreshToken` live on their phone.
That is the same trust model as the Codex CLI and any "stay signed in" app: protect
them at rest. `lwc-android`'s `KeystoreTokenStore` does this with
Android-Keystore-backed `EncryptedSharedPreferences`. Never log tokens; only
`ChatGPTUser` (account id, email, name, plan) is safe to surface in the UI.

This rides OpenAI's unofficial Codex OAuth client, so it could break if OpenAI
changes an endpoint — every URL/id is overridable via `ChatGPTConfig` to soften that.
