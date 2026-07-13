package com.opencoredev.loginwithchatgpt.android

import android.content.Context
import com.opencoredev.loginwithchatgpt.ChatGPTConfig
import com.opencoredev.loginwithchatgpt.ChatGPTUser
import com.opencoredev.loginwithchatgpt.CodexAuth
import com.opencoredev.loginwithchatgpt.CodexResponsesOptions
import com.opencoredev.loginwithchatgpt.DeviceCode
import com.opencoredev.loginwithchatgpt.DevicePollResult
import com.opencoredev.loginwithchatgpt.LoginStatus
import com.opencoredev.loginwithchatgpt.ResolvedConfig
import com.opencoredev.loginwithchatgpt.TokenStore
import com.opencoredev.loginwithchatgpt.codexResponses
import com.opencoredev.loginwithchatgpt.ensureFreshTokens
import com.opencoredev.loginwithchatgpt.exchangeDeviceAuthorization
import com.opencoredev.loginwithchatgpt.listCodexModels
import com.opencoredev.loginwithchatgpt.parseUser
import com.opencoredev.loginwithchatgpt.pollDeviceCode
import com.opencoredev.loginwithchatgpt.requestDeviceCode
import com.opencoredev.loginwithchatgpt.resolveConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonObject

/**
 * The on-device facade: wires the pure-Kotlin engine to a Keystore-backed token
 * store and a Custom Tab launcher. One instance owns a signed-in ChatGPT session.
 *
 * Typical flow:
 * ```
 * val lwc = LoginWithChatGPT(context)
 * val device = lwc.startDeviceLogin()
 * lwc.openVerification(device)                 // user enters device.userCode
 * while (lwc.poll(device) is DevicePollResult.Pending) delay(device.interval * 1000L)
 * lwc.chat(buildJsonObject { put("model", "gpt-5.5"); put("input", "Hi") }).collect { print(it) }
 * ```
 */
class LoginWithChatGPT(
    context: Context,
    config: ChatGPTConfig = ChatGPTConfig(),
    private val store: TokenStore = KeystoreTokenStore(context),
) {
    private val appContext = context.applicationContext
    private val resolved: ResolvedConfig = resolveConfig(config)

    /** Coarse status derived from stored credentials. */
    suspend fun status(): LoginStatus {
        val tokens = store.load() ?: return LoginStatus.UNAUTHENTICATED
        return if (tokens.accessToken.isNotEmpty()) LoginStatus.AUTHENTICATED else LoginStatus.UNAUTHENTICATED
    }

    /** The signed-in user's public profile, or null if signed out. */
    suspend fun currentUser(): ChatGPTUser? = store.load()?.let { parseUser(it.idToken) }

    /** Starts a device login; show [DeviceCode.userCode] and send the user to verify. */
    suspend fun startDeviceLogin(): DeviceCode = requestDeviceCode(resolved)

    /** Opens the verification page in a Custom Tab. */
    fun openVerification(device: DeviceCode) = VerificationLauncher.open(appContext, device.verificationUrl)

    /** Polls once. On authorization, exchanges + persists tokens and returns Authorized. */
    suspend fun poll(device: DeviceCode): DevicePollResult {
        val result = pollDeviceCode(resolved, device)
        if (result is DevicePollResult.Authorized) {
            store.save(exchangeDeviceAuthorization(resolved, result))
        }
        return result
    }

    /** Clears stored credentials. */
    suspend fun logout() = store.clear()

    /** The account's currently available Codex model slugs. */
    suspend fun models(): List<String> = listCodexModels(resolved, freshAuth())

    /** Streams a Codex `/responses` completion as assistant-text deltas. */
    fun chat(body: JsonObject, options: CodexResponsesOptions = CodexResponsesOptions()): Flow<String> =
        codexResponses(resolved, getAuth = { freshAuth() }, body = body, options = options)

    /** Refreshes tokens if needed (persisting the result) and returns request auth. */
    private suspend fun freshAuth(): CodexAuth {
        val tokens = ensureFreshTokens(resolved, store.load(), onRefresh = { store.save(it) })
        return CodexAuth(
            accessToken = tokens.accessToken,
            accountId = tokens.accountId ?: error("No ChatGPT account id available; sign in again."),
        )
    }
}
