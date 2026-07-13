# Login with ChatGPT — Android

On-device, serverless Android port of the [Login with ChatGPT](../README.md) SDK.
Users sign in with **their own** ChatGPT subscription via OpenAI's device-code
OAuth flow, and the app calls Codex models billed to that user — no OpenAI API key,
and no backend to host. Tokens live on the device in the Android Keystore.

## Modules

| Module | What it is |
| --- | --- |
| [`lwc-core`](./lwc-core) | Pure Kotlin/JVM engine — device flow, token refresh, JWT parsing, Codex streaming. No Android deps; unit-tested on the JVM. Port of the TS `-core` package. |
| `lwc-android` | Android library — `KeystoreTokenStore` (encrypted at rest), a Custom Tab launcher, and the `LoginWithChatGPT` facade. |
| `sample` | Minimal Compose app: sign-in screen → device code → streamed chat. |

## Build & run

Uses the Gradle wrapper (8.11.1) — the JDK 17 toolchain and Android SDK are picked
up from `JAVA_HOME` / `local.properties`.

On a low-RAM machine (≤8 GB), add these to your user `~/.gradle/gradle.properties`
to keep the build inside one small JVM:

```properties
org.gradle.jvmargs=-Xmx1024m -XX:MaxMetaspaceSize=512m
org.gradle.workers.max=1
kotlin.compiler.execution.strategy=in-process
```

```bash
# Run the pure-JVM unit tests (body normalization + JWT parsing)
./gradlew :lwc-core:test

# Stage-0 spike: full device login + streamed reply against a REAL ChatGPT account
./gradlew :lwc-core:run --args="Say hello in one short sentence."

# Build the sample APK
./gradlew :sample:assembleDebug

# Install + launch on a running emulator/device
./gradlew :sample:installDebug
adb shell am start -n com.opencoredev.loginwithchatgpt.sample/.MainActivity
```

## Using the library in your own app

```kotlin
val lwc = LoginWithChatGPT(context)                    // Keystore-backed by default

// Sign in
val device = lwc.startDeviceLogin()
lwc.openVerification(device)                           // Custom Tab; user enters device.userCode
while (lwc.poll(device) is DevicePollResult.Pending) delay(device.interval * 1000L)

// Call a model — billed to the signed-in user's ChatGPT plan
lwc.chat(buildJsonObject { put("model", "gpt-5.5"); put("input", "Hi") })
    .collect { delta -> /* append streamed text */ }
```

## Security & status

Tokens are encrypted at rest via Android-Keystore-backed `EncryptedSharedPreferences`
(see [`lwc-core/README`](./lwc-core/README.md) for the trust-boundary notes). This
rides OpenAI's unofficial Codex OAuth client, so it may break if OpenAI changes an
endpoint — every URL/id is overridable through `ChatGPTConfig`.
