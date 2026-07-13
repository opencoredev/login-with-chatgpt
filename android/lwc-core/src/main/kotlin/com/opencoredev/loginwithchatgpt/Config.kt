package com.opencoredev.loginwithchatgpt

import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * Overridable configuration for every auth/transport call. All fields have
 * sensible Codex defaults; override any of them so the SDK survives OpenAI
 * moving an endpoint. Mirrors the TS `ChatGPTConfig`.
 */
data class ChatGPTConfig(
    val clientId: String = Constants.DEFAULT_CLIENT_ID,
    val issuer: String = Constants.DEFAULT_ISSUER,
    val scope: String = Constants.DEFAULT_SCOPE,
    val codexBaseUrl: String = Constants.DEFAULT_CODEX_BASE_URL,
    val originator: String = Constants.DEFAULT_ORIGINATOR,
    val clientVersion: String = Constants.DEFAULT_CLIENT_VERSION,
    /** HTTP client. Override to inject interceptors, proxies, or test doubles. */
    val httpClient: OkHttpClient? = null,
)

/** Fully-resolved configuration with all endpoint URLs derived from the issuer. */
class ResolvedConfig internal constructor(
    val clientId: String,
    val issuer: String,
    val scope: String,
    val codexBaseUrl: String,
    val originator: String,
    val clientVersion: String,
    val httpClient: OkHttpClient,
) {
    /** OAuth token endpoint. */
    val tokenUrl: String = "$issuer/oauth/token"

    /** OAuth authorization endpoint. */
    val authorizeUrl: String = "$issuer/oauth/authorize"

    /** Device-auth API base. */
    val deviceApiBase: String = "$issuer/api/accounts"

    /** User-facing device verification page. */
    val deviceVerificationUrl: String = "$issuer/codex/device"

    /** Redirect URI used to exchange a device authorization code. */
    val deviceRedirectUri: String = "$issuer/deviceauth/callback"
}

private fun stripTrailingSlash(value: String): String = value.trimEnd('/')

/** Streaming-friendly default client: long read timeout for SSE, no call timeout. */
private fun defaultHttpClient(): OkHttpClient =
    OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .callTimeout(0, TimeUnit.MILLISECONDS)
        .build()

/** Applies defaults and derives every endpoint URL from the issuer. */
fun resolveConfig(config: ChatGPTConfig = ChatGPTConfig()): ResolvedConfig {
    val issuer = stripTrailingSlash(config.issuer)
    return ResolvedConfig(
        clientId = config.clientId,
        issuer = issuer,
        scope = config.scope,
        codexBaseUrl = stripTrailingSlash(config.codexBaseUrl),
        originator = config.originator,
        clientVersion = config.clientVersion,
        httpClient = config.httpClient ?: defaultHttpClient(),
    )
}
