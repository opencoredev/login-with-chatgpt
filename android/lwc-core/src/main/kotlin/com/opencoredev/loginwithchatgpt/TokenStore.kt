package com.opencoredev.loginwithchatgpt

import java.util.concurrent.atomic.AtomicReference

/**
 * Persists the signed-in user's tokens. The pure-Kotlin core ships an in-memory
 * implementation; the `lwc-android` module provides a Keystore-backed one.
 */
interface TokenStore {
    suspend fun load(): ChatGPTTokens?
    suspend fun save(tokens: ChatGPTTokens)
    suspend fun clear()
}

/** Non-persistent store — process memory only. Useful for the spike and tests. */
class InMemoryTokenStore(initial: ChatGPTTokens? = null) : TokenStore {
    private val ref = AtomicReference(initial)
    override suspend fun load(): ChatGPTTokens? = ref.get()
    override suspend fun save(tokens: ChatGPTTokens) = ref.set(tokens)
    override suspend fun clear() = ref.set(null)
}
