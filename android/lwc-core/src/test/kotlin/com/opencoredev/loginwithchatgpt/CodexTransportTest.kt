package com.opencoredev.loginwithchatgpt

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Ported from `packages/core/test/codex-transport.test.ts`. */
class CodexTransportTest {
    @Test
    fun `normalizeResponsesBody adds all Codex stateless requirements`() {
        val out = normalizeResponsesBody(
            buildJsonObject { put("input", "hi"); put("max_output_tokens", 100) },
            CodexResponsesOptions(instructions = "sys"),
        )
        assertEquals("sys", out["instructions"]?.jsonPrimitive?.contentOrNull)
        assertEquals(false, out["store"]?.jsonPrimitive?.booleanOrNull)
        val reasoning = out["reasoning"] as JsonObject
        assertEquals("medium", reasoning["effort"]?.jsonPrimitive?.contentOrNull)
        assertEquals("auto", reasoning["summary"]?.jsonPrimitive?.contentOrNull)
        assertEquals("medium", (out["text"] as JsonObject)["verbosity"]?.jsonPrimitive?.contentOrNull)
        val include = (out["include"] as JsonArray).map { it.jsonPrimitive.content }
        assertTrue(include.contains("reasoning.encrypted_content"))
        assertNull(out["max_output_tokens"])
    }

    @Test
    fun `normalizeResponsesBody keeps caller instructions and merges reasoning overrides`() {
        val out = normalizeResponsesBody(
            buildJsonObject {
                put("input", "hi")
                put("instructions", "keep")
                put("reasoning", buildJsonObject { put("effort", "high") })
            },
            CodexResponsesOptions(reasoningEffort = "low"),
        )
        assertEquals("keep", out["instructions"]?.jsonPrimitive?.contentOrNull)
        // caller-provided reasoning.effort wins over the option default
        assertEquals("high", (out["reasoning"] as JsonObject)["effort"]?.jsonPrimitive?.contentOrNull)
        assertEquals(false, out["store"]?.jsonPrimitive?.booleanOrNull)
    }

    @Test
    fun `normalizeResponsesBody accepts Codex service tier defaults`() {
        val out = normalizeResponsesBody(buildJsonObject { put("input", "hi") }, CodexResponsesOptions(serviceTier = "fast"))
        assertEquals("fast", out["service_tier"]?.jsonPrimitive?.contentOrNull)

        val callerTier = normalizeResponsesBody(
            buildJsonObject { put("input", "hi"); put("service_tier", "flex") },
            CodexResponsesOptions(serviceTier = "fast"),
        )
        assertEquals("flex", callerTier["service_tier"]?.jsonPrimitive?.contentOrNull)
    }

    @Test
    fun `normalizeResponsesBody strips input ids and drops item_reference`() {
        val out = normalizeResponsesBody(
            buildJsonObject {
                put(
                    "input",
                    buildJsonArray {
                        add(buildJsonObject { put("id", "msg_1"); put("type", "message"); put("role", "user"); put("content", buildJsonArray {}) })
                        add(buildJsonObject { put("type", "item_reference"); put("id", "ref_1") })
                    },
                )
            },
        )
        val input = out["input"] as JsonArray
        assertEquals(1, input.size)
        val first = input[0] as JsonObject
        assertFalse(first.containsKey("id"))
        assertEquals("message", first["type"]?.jsonPrimitive?.contentOrNull)
    }

    @Test
    fun `resolveTargetUrl maps absolute and relative inputs onto the codex base`() {
        val base = "https://chatgpt.com/backend-api/codex"
        assertEquals("$base/responses", resolveTargetUrl("https://api.openai.com/v1/responses", base))
        assertEquals("$base/responses", resolveTargetUrl("/responses", base))
        assertEquals("$base/responses", resolveTargetUrl("$base/responses", base))
    }

    @Test
    fun `resolveTargetUrl preserves custom ports in overridden base URLs`() {
        // e.g. the Android emulator's host loopback, or a local proxy
        val base = "http://10.0.2.2:8080/backend-api/codex"
        assertEquals("$base/responses", resolveTargetUrl("/responses", base))
        assertEquals("$base/responses", resolveTargetUrl("https://api.openai.com/v1/responses", base))
        assertEquals("$base/models?x=1", resolveTargetUrl("/models?x=1", base))
    }

    @Test
    fun `withClientVersion adds param when absent and preserves an explicit one`() {
        val base = "https://chatgpt.com/backend-api/codex/responses"
        assertTrue(withClientVersion(base, "0.142.5").contains("client_version=0.142.5"))
        assertTrue(withClientVersion("$base?client_version=9.9.9", "0.142.5").contains("client_version=9.9.9"))
    }

    @Test
    fun `extractCodexModelSlugs supports known model-list wrappers`() {
        assertEquals(
            listOf("gpt-a", "gpt-b", "gpt-c"),
            extractCodexModelSlugs(
                buildJsonObject {
                    put("models", buildJsonArray {
                        add(buildJsonObject { put("slug", "gpt-a") })
                        add(buildJsonObject { put("id", "gpt-b") })
                        add(buildJsonObject { put("slug", "gpt-a") })
                        add(buildJsonObject { put("slug", "") })
                    })
                    put("data", buildJsonArray { add(buildJsonObject { put("model", "gpt-c") }) })
                },
            ),
        )
        assertEquals(
            listOf("gpt-c"),
            extractCodexModelSlugs(
                buildJsonObject {
                    put("models", buildJsonArray {})
                    put("data", buildJsonArray { add(buildJsonObject { put("model", "gpt-c") }) })
                },
            ),
        )
        assertEquals(
            listOf("gpt-d"),
            extractCodexModelSlugs(buildJsonArray { add(buildJsonObject { put("name", "gpt-d") }) }),
        )
        assertEquals(
            listOf("gpt-5.5", "gpt-5.4"),
            extractCodexModelSlugs(buildJsonObject { put("models", buildJsonArray { add(JsonPrimitive("gpt-5.5")); add(JsonPrimitive("gpt-5.4")) }) }),
        )
    }
}
