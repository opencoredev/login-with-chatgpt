package com.opencoredev.loginwithchatgpt.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent

/** Opens OpenAI's device-verification page in a Custom Tab (falls back to the browser). */
object VerificationLauncher {
    fun open(context: Context, url: String) {
        val customTab = CustomTabsIntent.Builder()
            .setShowTitle(true)
            .build()
        // Callers pass an application context; starting an activity from a
        // non-Activity context requires NEW_TASK or Android throws.
        customTab.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        customTab.launchUrl(context, Uri.parse(url))
    }
}
