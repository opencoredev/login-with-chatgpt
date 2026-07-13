package com.opencoredev.loginwithchatgpt.android

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent

/** Opens OpenAI's device-verification page in a Custom Tab (falls back to the browser). */
object VerificationLauncher {
    fun open(context: Context, url: String) {
        CustomTabsIntent.Builder()
            .setShowTitle(true)
            .build()
            .launchUrl(context, Uri.parse(url))
    }
}
