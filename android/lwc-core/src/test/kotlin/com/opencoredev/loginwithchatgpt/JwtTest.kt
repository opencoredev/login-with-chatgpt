package com.opencoredev.loginwithchatgpt

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Ported from `packages/core/test/jwt.test.ts` (and `helpers.ts`). */
class JwtTest {
    private fun b64Url(s: String): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(s.toByteArray())

    /** Builds an unsigned JWT (`alg: none`) with the given claims. */
    private fun makeJwt(build: JsonObjectBuilder.() -> Unit): String {
        val header = b64Url("""{"alg":"none","typ":"JWT"}""")
        val body = b64Url(buildJsonObject(build).toString())
        return "$header.$body.sig"
    }

    private fun makeIdToken(accountId: String? = "acct_123", email: String? = null, name: String? = null, plan: String? = null): String =
        makeJwt {
            if (email != null) put("email", email)
            if (name != null) put("name", name)
            put("exp", (System.currentTimeMillis() / 1000) + 3600)
            put(
                Constants.AUTH_CLAIM,
                buildJsonObject {
                    put("chatgpt_account_id", accountId)
                    if (plan != null) put("chatgpt_plan_type", plan)
                },
            )
        }

    @Test
    fun `decodes a payload`() {
        val token = makeJwt { put("hello", "world"); put("n", 1) }
        val decoded = decodeJwt(token) as JsonObject
        assertEquals("world", decoded["hello"]?.jsonPrimitive?.contentOrNull)
        assertEquals(1, decoded["n"]?.jsonPrimitive?.intOrNull)
    }

    @Test
    fun `returns null for malformed tokens`() {
        assertNull(decodeJwt("not-a-jwt"))
        assertNull(decodeJwt(null))
        assertNull(decodeJwt("a.b"))
    }

    @Test
    fun `derives the ChatGPT account id from the auth claim`() {
        assertEquals("acct_xyz", deriveAccountId(makeIdToken(accountId = "acct_xyz")))
    }

    @Test
    fun `returns null account id when the claim is absent`() {
        assertNull(deriveAccountId(makeJwt { put("sub", "u") }))
    }

    @Test
    fun `reads token expiry in milliseconds`() {
        val token = makeJwt { put("exp", 2_000_000_000L) }
        assertEquals(2_000_000_000_000L, getTokenExpiry(token))
    }

    @Test
    fun `parses a public user profile`() {
        val token = makeIdToken(accountId = "acct_1", email = "a@b.dev", name = "Ada", plan = "pro")
        assertEquals(ChatGPTUser(accountId = "acct_1", email = "a@b.dev", name = "Ada", plan = "pro"), parseUser(token))
    }

    @Test
    fun `returns null user when account id is missing`() {
        assertNull(parseUser(makeJwt { put("email", "x@y.dev") }))
    }
}
