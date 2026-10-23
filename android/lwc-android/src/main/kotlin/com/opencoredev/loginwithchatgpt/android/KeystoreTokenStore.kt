package com.opencoredev.loginwithchatgpt.android

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.opencoredev.loginwithchatgpt.ChatGPTTokens
import com.opencoredev.loginwithchatgpt.TokenStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * [TokenStore] backed by Android-Keystore-encrypted SharedPreferences. The user's
 * ChatGPT access/refresh tokens are encrypted at rest; the master key lives in the
 * hardware-backed Keystore and never leaves it.
 */
class KeystoreTokenStore(
    context: Context,
    private val fileName: String = "lwc_tokens",
) : TokenStore {
    private val appContext = context.applicationContext
    private val json = Json { ignoreUnknownKeys = true }

    private val prefs by lazy {
        try {
            createPrefs()
        } catch (_: Exception) {
            // The file exists but can't be decrypted — e.g. restored from a
            // backup onto a device whose Keystore lacks the original master
            // key. Wipe it and start clean (user re-authenticates) rather
            // than crashing every launch.
            appContext.deleteSharedPreferences(fileName)
            createPrefs()
        }
    }

    private fun createPrefs() = EncryptedSharedPreferences.create(
        appContext,
        fileName,
        MasterKey.Builder(appContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    override suspend fun load(): ChatGPTTokens? = withContext(Dispatchers.IO) {
        runCatching { prefs.getString(KEY, null) }.getOrNull()
            ?.let { runCatching { json.decodeFromString<ChatGPTTokens>(it) }.getOrNull() }
    }

    override suspend fun save(tokens: ChatGPTTokens): Unit = withContext(Dispatchers.IO) {
        prefs.edit().putString(KEY, json.encodeToString(tokens)).apply()
    }

    override suspend fun clear(): Unit = withContext(Dispatchers.IO) {
        prefs.edit().remove(KEY).apply()
    }

    private companion object {
        const val KEY = "tokens"
    }
}
