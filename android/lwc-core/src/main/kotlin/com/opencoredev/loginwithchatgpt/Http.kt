package com.opencoredev.loginwithchatgpt

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import kotlin.coroutines.resumeWithException

/** Suspending OkHttp call. Cancels the request when the coroutine is cancelled. */
internal suspend fun OkHttpClient.await(request: Request): Response =
    suspendCancellableCoroutine { cont ->
        val call = newCall(request)
        cont.invokeOnCancellation { runCatching { call.cancel() } }
        call.enqueue(
            object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (cont.isCancelled) return
                    cont.resumeWithException(e)
                }

                override fun onResponse(call: Call, response: Response) {
                    // Close the response if the coroutine was cancelled after
                    // delivery — otherwise the connection leaks.
                    cont.resume(response) { _ -> runCatching { response.close() } }
                }
            },
        )
    }

/** Reads a response body as text, swallowing read errors. */
internal fun Response.safeText(): String = try {
    body?.string() ?: ""
} catch (_: Exception) {
    ""
}
