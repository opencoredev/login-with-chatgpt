package com.opencoredev.loginwithchatgpt

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** Auth material required to call the Codex responses API. */
data class CodexAuth(val accessToken: String, val accountId: String)

/** Options controlling the shape of a `/responses` request. */
data class CodexResponsesOptions(
    val instructions: String? = null,
    /** Reasoning effort. Defaults to `medium`. */
    val reasoningEffort: String? = null,
    /** Reasoning summary mode. Defaults to `auto`. */
    val reasoningSummary: String? = null,
    /** Text verbosity. Defaults to `medium`. */
    val textVerbosity: String? = null,
    /** Default service tier, e.g. `fast` for eligible GPT-5.5/5.4 sessions. */
    val serviceTier: String? = null,
)

private val json = Json { ignoreUnknownKeys = true }
private val jsonMedia = "application/json".toMediaType()

/**
 * Builds a `/responses` request body for a single user text prompt. The Codex
 * backend requires `input` to be a **list** of message items (a bare string is
 * rejected with `400 {"detail":"Input must be a list"}`), so wrap the text in the
 * Responses-API `input_text` message shape.
 */
fun textPromptBody(model: String, prompt: String): JsonObject = buildJsonObject {
    put("model", model)
    putJsonArray("input") {
        addJsonObject {
            put("type", "message")
            put("role", "user")
            putJsonArray("content") {
                addJsonObject {
                    put("type", "input_text")
                    put("text", prompt)
                }
            }
        }
    }
}

/**
 * Adapts a standard OpenAI responses payload for the ChatGPT-backed Codex
 * endpoint, which runs **stateless** (`store: false`). Omitting any of these
 * yields a stream with no assistant text:
 *
 * - `reasoning` must be configured (Codex models always reason).
 * - `include` must request `reasoning.encrypted_content`.
 * - input items must not carry server-side ids, and `item_reference` items are removed.
 * - `max_output_tokens` / `max_completion_tokens` are rejected.
 *
 * Caller-provided values win over the defaults. Ported from `codex-transport.ts`.
 */
fun normalizeResponsesBody(body: JsonObject, options: CodexResponsesOptions = CodexResponsesOptions()): JsonObject {
    val out = LinkedHashMap<String, JsonElement>(body)

    if ((out["instructions"] as? JsonPrimitive)?.isString != true) {
        out["instructions"] = JsonPrimitive(options.instructions ?: Constants.DEFAULT_CODEX_INSTRUCTIONS)
    }

    // The ChatGPT backend requires stateless operation.
    out["store"] = JsonPrimitive(false)

    // Reasoning is required; keep any caller-provided fields on top of the defaults.
    val existingReasoning = out["reasoning"] as? JsonObject
    out["reasoning"] = buildJsonObject {
        put("effort", options.reasoningEffort ?: "medium")
        put("summary", options.reasoningSummary ?: "auto")
        existingReasoning?.forEach { (k, v) -> put(k, v) }
    }

    val existingText = out["text"] as? JsonObject
    out["text"] = buildJsonObject {
        put("verbosity", options.textVerbosity ?: "medium")
        existingText?.forEach { (k, v) -> put(k, v) }
    }

    if ((out["service_tier"] as? JsonPrimitive)?.isString != true && options.serviceTier != null) {
        out["service_tier"] = JsonPrimitive(options.serviceTier)
    }

    // Ensure encrypted reasoning content is included.
    val include = LinkedHashSet<String>()
    (out["include"] as? JsonArray)?.forEach { el ->
        (el as? JsonPrimitive)?.takeIf { it.isString }?.let { include.add(it.content) }
    }
    include.add(Constants.REASONING_ENCRYPTED_CONTENT)
    out["include"] = JsonArray(include.map { JsonPrimitive(it) })

    (out["input"] as? JsonArray)?.let { out["input"] = filterCodexInput(it) }

    out.remove("max_output_tokens")
    out.remove("max_completion_tokens")
    return JsonObject(out)
}

/**
 * Strips server-side ids from input items and removes `item_reference` entries,
 * which the stateless Codex API does not accept.
 */
fun filterCodexInput(input: JsonArray): JsonArray =
    JsonArray(
        input
            .filter { !(it is JsonObject && (it["type"] as? JsonPrimitive)?.contentOrNull == "item_reference") }
            .map { item ->
                if (item is JsonObject && item.containsKey("id")) {
                    JsonObject(item.filterKeys { it != "id" })
                } else {
                    item
                }
            },
    )

/**
 * Maps an incoming URL onto the Codex base URL, tolerating both absolute URLs and
 * bare paths, and stripping a redundant `/v1` segment.
 */
fun resolveTargetUrl(input: String, codexBaseUrl: String): String {
    val base = codexBaseUrl.toHttpUrl()
    val basePath = base.encodedPath.trimEnd('/')
    val parsed = if (Regex("^https?://").containsMatchIn(input)) {
        input.toHttpUrl()
    } else {
        ("https://placeholder.invalid" + if (input.startsWith("/")) input else "/$input").toHttpUrl()
    }

    var pathname = parsed.encodedPath
    if (basePath.isNotEmpty() && pathname.startsWith("$basePath/")) pathname = pathname.substring(basePath.length)
    if (pathname == "/v1") pathname = "/" else if (pathname.startsWith("/v1/")) pathname = pathname.substring(3)
    if (!pathname.startsWith("/")) pathname = "/$pathname"

    val search = parsed.encodedQuery?.let { "?$it" } ?: ""
    return "${base.scheme}://${base.host}$basePath$pathname$search"
}

/** Ensures the `client_version` query param is present (the model gate depends on it). */
fun withClientVersion(targetUrl: String, clientVersion: String): String {
    if (clientVersion.isEmpty()) return targetUrl
    val url = targetUrl.toHttpUrl()
    if (url.queryParameter("client_version") != null) return targetUrl
    return url.newBuilder().addQueryParameter("client_version", clientVersion).build().toString()
}

/**
 * Extracts model slugs from the shapes the ChatGPT backend has used for model
 * lists. Unknown entries are ignored. Ported from `extractCodexModelSlugs`.
 */
fun extractCodexModelSlugs(value: JsonElement): List<String> {
    val seen = LinkedHashSet<String>()

    fun visit(item: JsonElement) {
        val candidate = when (item) {
            is JsonPrimitive -> if (item.isString) item.content else null
            is JsonObject -> listOf("slug", "id", "model", "name")
                .firstNotNullOfOrNull { (item[it] as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
            else -> null
        }
        val slug = candidate?.trim().orEmpty()
        if (slug.isNotEmpty()) seen.add(slug)
    }

    val candidateLists: List<JsonArray> = when (value) {
        is JsonArray -> listOf(value)
        is JsonObject -> listOf("models", "data", "items", "available_models").mapNotNull { value[it] as? JsonArray }
        else -> emptyList()
    }
    for (list in candidateLists) for (item in list) visit(item)
    return seen.toList()
}

private fun buildCodexRequest(config: ResolvedConfig, auth: CodexAuth, target: String): Request.Builder =
    Request.Builder()
        .url(target)
        .header("Authorization", "Bearer ${auth.accessToken}")
        .header("chatgpt-account-id", auth.accountId)
        .header("OpenAI-Beta", "responses=experimental")
        .header("originator", config.originator)

/**
 * Streams a Codex `/responses` completion, emitting assistant text deltas as they
 * arrive. `getAuth` supplies fresh auth (wire it to a token store + [ensureFreshTokens]).
 */
fun codexResponses(
    config: ResolvedConfig,
    getAuth: suspend () -> CodexAuth,
    body: JsonObject,
    options: CodexResponsesOptions = CodexResponsesOptions(),
): Flow<String> = flow {
    val auth = getAuth()
    // This helper streams, so the request must ask for SSE (`stream: true`);
    // without it the Codex backend returns a single JSON body, not an event stream.
    val normalized = JsonObject(normalizeResponsesBody(body, options) + ("stream" to JsonPrimitive(true)))
    val target = withClientVersion(
        resolveTargetUrl("${config.codexBaseUrl}/responses", config.codexBaseUrl),
        config.clientVersion,
    )
    val request = buildCodexRequest(config, auth, target)
        .header("Accept", "text/event-stream")
        .post(normalized.toString().toRequestBody(jsonMedia))
        .build()

    val debug = System.getenv("LWC_DEBUG") != null

    val response = config.httpClient.await(request)
    if (debug) System.err.println("SSE| HTTP ${response.code} ${response.header("content-type")}")
    if (!response.isSuccessful) {
        val text = response.safeText()
        response.close()
        throw ChatGPTAuthError("responses_request_failed", "Codex /responses failed (${response.code}).", status = response.code, body = text)
    }

    response.body?.source()?.use { source ->
        while (!source.exhausted()) {
            val line = source.readUtf8Line() ?: break
            if (debug && line.isNotBlank()) System.err.println("SSE| ${line.take(400)}")
            if (!line.startsWith("data:")) continue
            val data = line.substring(5).trim()
            if (data.isEmpty() || data == "[DONE]") continue
            val event = try {
                json.parseToJsonElement(data).jsonObject
            } catch (_: Exception) {
                continue
            }
            when (event["type"]?.jsonPrimitive?.contentOrNull) {
                "response.output_text.delta" ->
                    event["delta"]?.jsonPrimitive?.contentOrNull?.let { emit(it) }
                "response.failed", "error" ->
                    throw ChatGPTAuthError("responses_stream_error", "Codex stream reported: $data", body = data)
            }
        }
    }
}.flowOn(Dispatchers.IO)

/** Fetches the signed-in ChatGPT account's currently available Codex model slugs. */
suspend fun listCodexModels(config: ResolvedConfig, auth: CodexAuth): List<String> {
    val target = withClientVersion(
        resolveTargetUrl("${config.codexBaseUrl}/models", config.codexBaseUrl),
        config.clientVersion,
    )
    val request = buildCodexRequest(config, auth, target)
        .header("Accept", "application/json")
        .get()
        .build()

    val response = config.httpClient.await(request)
    response.use {
        if (!it.isSuccessful) {
            throw ChatGPTAuthError("models_request_failed", "Model list request failed (${it.code}).", status = it.code, body = it.safeText())
        }
        return extractCodexModelSlugs(json.parseToJsonElement(it.safeText()))
    }
}
