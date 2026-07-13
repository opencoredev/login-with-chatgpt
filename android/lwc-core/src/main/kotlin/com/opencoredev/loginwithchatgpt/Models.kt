package com.opencoredev.loginwithchatgpt

import kotlinx.serialization.Serializable

/**
 * OAuth tokens for a signed-in ChatGPT user.
 *
 * [accessToken] is short-lived; [refreshToken] mints new access tokens. Both are
 * secrets — on device they live in the Android Keystore-backed store. [accountId]
 * is derived from the id token and is required on every model request.
 */
@Serializable
data class ChatGPTTokens(
    val accessToken: String,
    val refreshToken: String? = null,
    val idToken: String? = null,
    /** ChatGPT account id (`chatgpt_account_id` claim), sent as a request header. */
    val accountId: String? = null,
    /** Epoch milliseconds at which [accessToken] expires, when known. */
    val expiresAt: Long? = null,
)

/** Public profile derived from the id token — safe to show in the UI. */
@Serializable
data class ChatGPTUser(
    val accountId: String,
    val email: String? = null,
    val name: String? = null,
    /** ChatGPT plan, e.g. `"free"`, `"plus"`, `"pro"`, when present in the token. */
    val plan: String? = null,
)

/**
 * A pending device-code login. Show [userCode] to the user and send them to
 * [verificationUrl]; poll until they authorize.
 */
data class DeviceCode(
    /** Opaque handle used when polling for completion. */
    val deviceAuthId: String,
    /** Short human-enterable code (e.g. `7B0J-DPK78`). */
    val userCode: String,
    /** URL the user opens to enter [userCode]. */
    val verificationUrl: String,
    /** Minimum seconds to wait between polls. */
    val interval: Int,
    /** Epoch milliseconds after which the code is no longer valid. */
    val expiresAt: Long,
)

/** Result of a single device-token poll. */
sealed interface DevicePollResult {
    data object Pending : DevicePollResult

    data class Authorized(
        val authorizationCode: String,
        val codeChallenge: String,
        val codeVerifier: String,
    ) : DevicePollResult
}

/** High-level status of a login session. */
enum class LoginStatus {
    UNAUTHENTICATED,
    PENDING,
    AUTHENTICATED,
    EXPIRED,
    ERROR,
}

/** Structured auth/transport failure, mirroring the TS `ChatGPTAuthError`. */
class ChatGPTAuthError(
    val code: String,
    message: String,
    val status: Int? = null,
    val body: String? = null,
    cause: Throwable? = null,
) : Exception(message, cause)
