package com.opencoredev.loginwithchatgpt

/**
 * Wire-protocol constants for the ChatGPT (Codex) OAuth flow.
 *
 * These mirror the public OpenAI Codex CLI client. Logging in with them grants
 * access to the end user's own ChatGPT plan (Free/Plus/Pro) — usage is billed to
 * that user, never to the app developer. Every value is overridable through
 * [ChatGPTConfig] so the SDK keeps working if OpenAI moves an endpoint.
 *
 * Ported from `packages/core/src/constants.ts`.
 */
object Constants {
    /** Public OAuth client id used by the Codex CLI. */
    const val DEFAULT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"

    /** OAuth issuer / authorization server origin. */
    const val DEFAULT_ISSUER = "https://auth.openai.com"

    /** OAuth scopes required to obtain a refreshable ChatGPT session. */
    const val DEFAULT_SCOPE = "openid profile email offline_access"

    /** Base URL of the ChatGPT-backed Codex model API. */
    const val DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex"

    /** `originator` header/param value that identifies the client to OpenAI. */
    const val DEFAULT_ORIGINATOR = "codex_cli_rs"

    /** JWT claim namespace that carries ChatGPT account/plan metadata. */
    const val AUTH_CLAIM = "https://api.openai.com/auth"

    /** Device codes expire server-side ~15 minutes after issue. */
    const val DEVICE_CODE_TTL_MS = 15L * 60L * 1000L

    /** Default model used by the Codex responses API when the caller omits one. */
    const val DEFAULT_MODEL = "gpt-5.5"

    /**
     * Codex client version sent as the `client_version` query parameter. The
     * ChatGPT backend gates the available model set on this — omitting it (or
     * sending a stale value) makes every model report as "not supported". Bump
     * toward the current Codex CLI release if models disappear.
     */
    const val DEFAULT_CLIENT_VERSION = "0.142.5"

    /** Default system instructions sent to the Codex responses API. */
    const val DEFAULT_CODEX_INSTRUCTIONS =
        "You are a helpful assistant powered by the user's ChatGPT account. " +
            "Answer the user's request directly and helpfully."

    /**
     * The Codex backend runs stateless (`store: false`), so reasoning continuity
     * is carried in encrypted reasoning content that must be explicitly requested.
     */
    const val REASONING_ENCRYPTED_CONTENT = "reasoning.encrypted_content"
}
