package com.opencoredev.loginwithchatgpt

import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * The device-authorization flow — the mobile-friendly path. Unlike the loopback
 * PKCE flow it needs no redirect listener, so it works on phones, servers, and
 * CLIs. The PKCE pair is returned by OpenAI in the poll response, so the client
 * never computes one.
 *
 * Ported from `packages/core/src/device.ts`.
 */

private val json = Json { ignoreUnknownKeys = true }
private val jsonMedia = "application/json".toMediaType()

/** Requests a fresh device code from OpenAI. */
suspend fun requestDeviceCode(config: ResolvedConfig, now: () -> Long = System::currentTimeMillis): DeviceCode {
    val url = "${config.deviceApiBase}/deviceauth/usercode"
    val payload = buildJsonObject { put("client_id", config.clientId) }
    val request = Request.Builder()
        .url(url)
        .header("Accept", "application/json")
        .post(payload.toString().toRequestBody(jsonMedia))
        .build()

    val response = try {
        config.httpClient.await(request)
    } catch (cause: Exception) {
        throw ChatGPTAuthError("network_error", "Failed to reach the device authorization endpoint.", cause = cause)
    }
    response.use {
        if (it.code == 404) {
            throw ChatGPTAuthError(
                "device_code_disabled",
                "Device-code login is not enabled for this server. Verify the issuer URL or use the redirect flow.",
                status = 404,
            )
        }
        if (!it.isSuccessful) {
            throw ChatGPTAuthError("device_code_request_failed", "Device code request failed (${it.code}).", status = it.code, body = it.safeText())
        }
        val raw = json.parseToJsonElement(it.safeText()).jsonObject
        val deviceAuthId = raw["device_auth_id"]?.jsonPrimitive?.contentOrNull
        val userCode = raw["user_code"]?.jsonPrimitive?.contentOrNull
            ?: raw["usercode"]?.jsonPrimitive?.contentOrNull
        if (deviceAuthId == null || userCode == null) {
            throw ChatGPTAuthError("device_code_request_failed", "Device code response was missing required fields.")
        }
        return DeviceCode(
            deviceAuthId = deviceAuthId,
            userCode = userCode,
            verificationUrl = config.deviceVerificationUrl,
            interval = normalizeInterval(raw["interval"]),
            expiresAt = now() + Constants.DEVICE_CODE_TTL_MS,
        )
    }
}

/**
 * Polls once for device-authorization completion. Returns [DevicePollResult.Pending]
 * while the user has not finished, or [DevicePollResult.Authorized] with the code
 * and server-generated PKCE pair to exchange for tokens.
 */
suspend fun pollDeviceCode(config: ResolvedConfig, device: DeviceCode): DevicePollResult {
    val url = "${config.deviceApiBase}/deviceauth/token"
    val payload = buildJsonObject {
        put("device_auth_id", device.deviceAuthId)
        put("user_code", device.userCode)
    }
    val request = Request.Builder()
        .url(url)
        .header("Accept", "application/json")
        .post(payload.toString().toRequestBody(jsonMedia))
        .build()

    val response = try {
        config.httpClient.await(request)
    } catch (cause: Exception) {
        throw ChatGPTAuthError("network_error", "Failed to reach the device token endpoint.", cause = cause)
    }
    response.use {
        // 403/404 are the documented "keep waiting" responses; 429 is a transient
        // Cloudflare rate-limit/challenge on the polling endpoint — also retryable.
        if (it.code == 403 || it.code == 404 || it.code == 429) return DevicePollResult.Pending
        if (!it.isSuccessful) {
            throw ChatGPTAuthError("token_exchange_failed", "Device authorization failed (${it.code}).", status = it.code, body = it.safeText())
        }
        val raw = json.parseToJsonElement(it.safeText()).jsonObject
        val code = raw["authorization_code"]?.jsonPrimitive?.contentOrNull
        val verifier = raw["code_verifier"]?.jsonPrimitive?.contentOrNull
        val challenge = raw["code_challenge"]?.jsonPrimitive?.contentOrNull
        // A 200 without a code means it is still binding — treat as pending.
        if (code == null || verifier == null || challenge == null) return DevicePollResult.Pending
        return DevicePollResult.Authorized(authorizationCode = code, codeChallenge = challenge, codeVerifier = verifier)
    }
}

/** Exchanges a successful device poll for tokens. */
suspend fun exchangeDeviceAuthorization(config: ResolvedConfig, poll: DevicePollResult.Authorized): ChatGPTTokens =
    exchangeAuthorizationCode(
        config,
        code = poll.authorizationCode,
        codeVerifier = poll.codeVerifier,
        redirectUri = config.deviceRedirectUri,
    )

/**
 * Blocks until the user authorizes the device or the code expires. Intended for
 * CLIs/spikes; a UI should drive [pollDeviceCode] from its own polling loop.
 */
suspend fun waitForDeviceTokens(
    config: ResolvedConfig,
    device: DeviceCode,
    intervalMs: Long = device.interval * 1000L,
    now: () -> Long = System::currentTimeMillis,
    onPoll: ((attempt: Int) -> Unit)? = null,
): ChatGPTTokens {
    var attempt = 0
    while (now() < device.expiresAt) {
        onPoll?.invoke(++attempt)
        when (val result = pollDeviceCode(config, device)) {
            is DevicePollResult.Authorized -> return exchangeDeviceAuthorization(config, result)
            DevicePollResult.Pending -> delay(intervalMs)
        }
    }
    throw ChatGPTAuthError("authorization_expired", "Device authorization expired before the user completed sign-in.")
}

private fun normalizeInterval(value: kotlinx.serialization.json.JsonElement?): Int {
    val prim = value?.jsonPrimitive ?: return 5
    prim.intOrNull?.let { if (it > 0) return it }
    prim.contentOrNull?.trim()?.toIntOrNull()?.let { if (it > 0) return it }
    return 5
}
