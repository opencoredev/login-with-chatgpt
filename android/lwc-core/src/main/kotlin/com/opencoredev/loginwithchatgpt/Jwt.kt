package com.opencoredev.loginwithchatgpt

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import java.util.Base64

private val lenientJson = Json { ignoreUnknownKeys = true; isLenient = true }

/** Decodes a base64url segment (no padding) to a UTF-8 string. */
internal fun base64UrlDecodeToString(segment: String): String =
    String(Base64.getUrlDecoder().decode(padBase64Url(segment)))

private fun padBase64Url(value: String): String {
    val remainder = value.length % 4
    return if (remainder == 0) value else value + "=".repeat(4 - remainder)
}

/**
 * Decodes a JWT payload **without verifying its signature**. These tokens come
 * straight from OpenAI's token endpoint over TLS, so we only read claims we
 * already trust. Never use this to validate a token from an untrusted source.
 */
fun decodeJwt(token: String?): JsonObject? {
    if (token == null) return null
    val parts = token.split(".")
    if (parts.size != 3 || parts[1].isEmpty()) return null
    return try {
        lenientJson.parseToJsonElement(base64UrlDecodeToString(parts[1])).jsonObject
    } catch (_: Exception) {
        null
    }
}

/** Extracts the `exp` claim as epoch milliseconds, or `null`. */
fun getTokenExpiry(token: String?): Long? {
    val exp = decodeJwt(token)?.get("exp")?.jsonPrimitive?.longOrNull ?: return null
    return exp * 1000
}

/** Reads the ChatGPT account id from an id (or access) token. */
fun deriveAccountId(token: String?): String? {
    val auth = decodeJwt(token)?.get(Constants.AUTH_CLAIM) as? JsonObject ?: return null
    return auth["chatgpt_account_id"]?.jsonPrimitive?.contentOrNull
}

/** Builds a public [ChatGPTUser] profile from an id token. */
fun parseUser(idToken: String?): ChatGPTUser? {
    val claims = decodeJwt(idToken) ?: return null
    val accountId = deriveAccountId(idToken) ?: return null
    val auth = claims[Constants.AUTH_CLAIM] as? JsonObject
    return ChatGPTUser(
        accountId = accountId,
        email = claims["email"]?.jsonPrimitive?.contentOrNull?.ifEmpty { null },
        name = claims["name"]?.jsonPrimitive?.contentOrNull?.ifEmpty { null },
        plan = auth?.get("chatgpt_plan_type")?.jsonPrimitive?.contentOrNull?.ifEmpty { null },
    )
}
