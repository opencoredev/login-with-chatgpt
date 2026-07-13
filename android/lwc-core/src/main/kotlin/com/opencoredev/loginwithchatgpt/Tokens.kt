package com.opencoredev.loginwithchatgpt

/** Refresh when the access token is within this window of expiring. */
private const val EXPIRY_MARGIN_MS = 60L * 1000L

/** `true` when the access token is missing, expired, or about to expire. */
fun isAccessTokenExpired(tokens: ChatGPTTokens, now: () -> Long = System::currentTimeMillis): Boolean {
    if (tokens.accessToken.isEmpty()) return true
    val expiresAt = tokens.expiresAt ?: getTokenExpiry(tokens.accessToken) ?: return false
    return expiresAt <= now() + EXPIRY_MARGIN_MS
}

/** Ensures `accountId` is populated by deriving it from the tokens when missing. */
private fun withAccountId(tokens: ChatGPTTokens): ChatGPTTokens {
    if (tokens.accountId != null) return tokens
    val accountId = deriveAccountId(tokens.idToken) ?: deriveAccountId(tokens.accessToken)
    return if (accountId != null) tokens.copy(accountId = accountId) else tokens
}

/**
 * Returns tokens guaranteed fresh enough to make an API call, refreshing via the
 * refresh token when needed and reporting the new tokens through [onRefresh].
 * Throws [ChatGPTAuthError] `not_authenticated` when nothing usable is available.
 */
suspend fun ensureFreshTokens(
    config: ResolvedConfig,
    tokens: ChatGPTTokens?,
    force: Boolean = false,
    now: () -> Long = System::currentTimeMillis,
    onRefresh: (suspend (ChatGPTTokens) -> Unit)? = null,
): ChatGPTTokens {
    if (tokens != null && tokens.accessToken.isNotEmpty() && !force && !isAccessTokenExpired(tokens, now)) {
        return withAccountId(tokens)
    }
    val refreshToken = tokens?.refreshToken
    if (refreshToken == null) {
        if (tokens != null && tokens.accessToken.isNotEmpty()) return withAccountId(tokens)
        throw ChatGPTAuthError("not_authenticated", "No ChatGPT credentials available. The user must sign in.")
    }
    val refreshed = withAccountId(refreshTokens(config, refreshToken))
    onRefresh?.invoke(refreshed)
    return refreshed
}
