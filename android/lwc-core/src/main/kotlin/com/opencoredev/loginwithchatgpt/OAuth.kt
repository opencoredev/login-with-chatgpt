package com.opencoredev.loginwithchatgpt

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.FormBody
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

private val json = Json { ignoreUnknownKeys = true }
private val jsonMedia = "application/json".toMediaType()

/** Normalizes OpenAI's token payload into [ChatGPTTokens]. */
private fun toTokens(raw: JsonObject, previousRefreshToken: String? = null): ChatGPTTokens {
    val accessToken = raw["access_token"]?.jsonPrimitive?.contentOrNull
        ?: throw ChatGPTAuthError("token_exchange_failed", "Token response missing access_token.")
    val idToken = raw["id_token"]?.jsonPrimitive?.contentOrNull
    val expiresIn = raw["expires_in"]?.jsonPrimitive?.intOrNull
    return ChatGPTTokens(
        accessToken = accessToken,
        refreshToken = raw["refresh_token"]?.jsonPrimitive?.contentOrNull ?: previousRefreshToken,
        idToken = idToken,
        accountId = deriveAccountId(idToken) ?: deriveAccountId(accessToken),
        expiresAt = if (expiresIn != null) System.currentTimeMillis() + expiresIn * 1000L else getTokenExpiry(accessToken),
    )
}

/** Exchanges an authorization code (+ PKCE verifier) for tokens. */
suspend fun exchangeAuthorizationCode(
    config: ResolvedConfig,
    code: String,
    codeVerifier: String,
    redirectUri: String,
): ChatGPTTokens {
    val form = FormBody.Builder()
        .add("grant_type", "authorization_code")
        .add("client_id", config.clientId)
        .add("code", code)
        .add("code_verifier", codeVerifier)
        .add("redirect_uri", redirectUri)
        .build()
    val request = Request.Builder()
        .url(config.tokenUrl)
        .header("Accept", "application/json")
        .post(form)
        .build()

    val response = try {
        config.httpClient.await(request)
    } catch (cause: Exception) {
        throw ChatGPTAuthError("network_error", "Failed to reach the token endpoint.", cause = cause)
    }
    response.use {
        if (!it.isSuccessful) {
            throw ChatGPTAuthError(
                "token_exchange_failed",
                "Authorization code exchange failed (${it.code}).",
                status = it.code,
                body = it.safeText(),
            )
        }
        return toTokens(json.parseToJsonElement(it.safeText()).jsonObject)
    }
}

/** Error codes OpenAI returns when a refresh token can no longer be used. */
private val DEAD_REFRESH_ERRORS = setOf(
    "refresh_token_expired",
    "refresh_token_reused",
    "refresh_token_invalidated",
    "invalid_grant",
)

/** Exchanges a refresh token for a fresh access token (and possibly a new refresh token). */
suspend fun refreshTokens(config: ResolvedConfig, refreshToken: String): ChatGPTTokens {
    val payload = buildJsonObject {
        put("grant_type", "refresh_token")
        put("refresh_token", refreshToken)
        put("client_id", config.clientId)
        put("scope", config.scope)
    }
    val request = Request.Builder()
        .url(config.tokenUrl)
        .header("Accept", "application/json")
        .post(payload.toString().toRequestBody(jsonMedia))
        .build()

    val response = try {
        config.httpClient.await(request)
    } catch (cause: Exception) {
        throw ChatGPTAuthError("network_error", "Failed to reach the token endpoint.", cause = cause)
    }
    response.use {
        if (!it.isSuccessful) {
            val text = it.safeText()
            val errorCode = extractErrorCode(text)
            if (errorCode != null && errorCode in DEAD_REFRESH_ERRORS) {
                throw ChatGPTAuthError(
                    "refresh_token_invalid",
                    "Refresh token is no longer valid ($errorCode). The user must sign in again.",
                    status = it.code,
                    body = text,
                )
            }
            throw ChatGPTAuthError("token_refresh_failed", "Token refresh failed (${it.code}).", status = it.code, body = text)
        }
        return toTokens(json.parseToJsonElement(it.safeText()).jsonObject, refreshToken)
    }
}

private fun extractErrorCode(body: String): String? = try {
    json.parseToJsonElement(body).jsonObject["error"]?.jsonPrimitive?.contentOrNull
} catch (_: Exception) {
    null
}
