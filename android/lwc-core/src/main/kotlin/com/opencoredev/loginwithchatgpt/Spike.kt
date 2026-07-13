package com.opencoredev.loginwithchatgpt

import kotlinx.coroutines.runBlocking

/**
 * Stage 0 de-risk spike (no UI). Runs the full on-device flow against a real
 * ChatGPT account and prints the result:
 *
 *   gradle :lwc-core:run --args="Say hello in one short sentence."
 *
 * Go/no-go gate: proves device login + a streamed /responses completion works
 * from a non-CLI native client, and that listCodexModels returns the account's
 * models — before any Android/Compose work.
 */
fun main(args: Array<String>) = runBlocking {
    val prompt = args.joinToString(" ").ifBlank { "Say hello in exactly one short sentence." }
    val config = resolveConfig()

    println("Requesting device code…")
    val device = requestDeviceCode(config)
    println()
    println("  1. Open: ${device.verificationUrl}")
    println("  2. Enter code: ${device.userCode}")
    println()
    println("Waiting for authorization (code expires in ~15 min)…")

    val tokens = waitForDeviceTokens(config, device) { attempt ->
        if (attempt % 5 == 0) println("  …still waiting (poll #$attempt)")
    }

    val user = parseUser(tokens.idToken)
    println()
    println("Signed in: ${user?.email ?: "(unknown email)"}  plan=${user?.plan ?: "?"}  account=${tokens.accountId}")

    val auth = CodexAuth(accessToken = tokens.accessToken, accountId = tokens.accountId ?: error("no account id"))

    println()
    println("Available models:")
    val models = listCodexModels(config, auth)
    models.forEach { println("  - $it") }
    check(models.isNotEmpty()) { "listCodexModels returned no models" }

    val model = if (models.contains(Constants.DEFAULT_MODEL)) Constants.DEFAULT_MODEL else models.first()

    println()
    println("Streaming a completion from '$model':")
    println("Prompt: $prompt")
    print("Reply: ")
    val body = textPromptBody(model, prompt)
    val sb = StringBuilder()
    try {
        codexResponses(config, getAuth = { auth }, body = body).collect { delta ->
            sb.append(delta)
            print(delta)
            System.out.flush()
        }
    } catch (e: ChatGPTAuthError) {
        println()
        System.err.println("‼ /responses failed: code=${e.code} httpStatus=${e.status}")
        System.err.println("‼ response body: ${e.body}")
        System.err.println("(Re-run with LWC_DEBUG=1 to dump the raw stream.)")
        throw e
    }
    println()
    check(sb.isNotBlank()) { "Stream produced no assistant text (AI_NoOutputGenerated) — check body normalization/headers." }
    println()
    println("✔ Stage 0 passed: login + models + streamed reply all worked.")
}
