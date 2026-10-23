package com.opencoredev.loginwithchatgpt.sample

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.opencoredev.loginwithchatgpt.ChatGPTUser
import com.opencoredev.loginwithchatgpt.Constants
import com.opencoredev.loginwithchatgpt.DeviceCode
import com.opencoredev.loginwithchatgpt.DevicePollResult
import com.opencoredev.loginwithchatgpt.android.LoginWithChatGPT
import com.opencoredev.loginwithchatgpt.textPromptBody
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val lwc = LoginWithChatGPT(applicationContext)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    AppScreen(lwc)
                }
            }
        }
    }
}

@Composable
private fun AppScreen(lwc: LoginWithChatGPT) {
    val scope = rememberCoroutineScope()
    var loading by remember { mutableStateOf(true) }
    var user by remember { mutableStateOf<ChatGPTUser?>(null) }
    var device by remember { mutableStateOf<DeviceCode?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        user = lwc.currentUser()
        loading = false
    }

    when {
        loading -> Centered { CircularProgressIndicator() }

        user != null -> ChatScreen(
            lwc = lwc,
            user = user!!,
            onLogout = { scope.launch { lwc.logout(); user = null } },
        )

        device != null -> PendingScreen(device = device!!, error = error, onReopen = { lwc.openVerification(device!!) })

        else -> LoginScreen(error = error, onLogin = {
            error = null
            scope.launch {
                try {
                    val d = lwc.startDeviceLogin()
                    device = d
                    lwc.openVerification(d)
                    while (true) {
                        if (System.currentTimeMillis() > d.expiresAt) {
                            error = "Code expired — try again."
                            device = null
                            break
                        }
                        val result = lwc.poll(d)
                        if (result is DevicePollResult.Authorized) {
                            user = lwc.currentUser()
                            device = null
                            break
                        }
                        delay(d.interval * 1000L)
                    }
                } catch (e: Exception) {
                    error = e.message ?: "Login failed."
                    device = null
                }
            }
        })
    }
}

@Composable
private fun LoginScreen(error: String?, onLogin: () -> Unit) {
    Centered {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Login with ChatGPT", style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(8.dp))
            Text(
                "Sign in with your own ChatGPT account. Models run on your plan — " +
                    "no API key, and usage is billed to you.",
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(24.dp))
            Button(onClick = onLogin) { Text("Sign in with ChatGPT") }
            if (error != null) {
                Spacer(Modifier.height(16.dp))
                Text(error, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center)
            }
        }
    }
}

@Composable
private fun PendingScreen(device: DeviceCode, error: String?, onReopen: () -> Unit) {
    Centered {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Enter this code on OpenAI", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(12.dp))
            Text(device.userCode, style = MaterialTheme.typography.displaySmall)
            Spacer(Modifier.height(24.dp))
            CircularProgressIndicator()
            Spacer(Modifier.height(16.dp))
            Text("Waiting for authorization…", style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(16.dp))
            OutlinedButton(onClick = onReopen) { Text("Reopen verification page") }
            if (error != null) {
                Spacer(Modifier.height(16.dp))
                Text(error, color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

@Composable
private fun ChatScreen(lwc: LoginWithChatGPT, user: ChatGPTUser, onLogout: () -> Unit) {
    val scope = rememberCoroutineScope()
    var prompt by remember { mutableStateOf("") }
    var reply by remember { mutableStateOf("") }
    var streaming by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Signed in as ${user.email ?: user.accountId}", style = MaterialTheme.typography.titleMedium)
        Text(
            "Plan: ${user.plan ?: "unknown"} · billed to this ChatGPT account",
            style = MaterialTheme.typography.bodySmall,
        )
        Spacer(Modifier.height(16.dp))

        OutlinedTextField(
            value = prompt,
            onValueChange = { prompt = it },
            label = { Text("Ask something") },
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(
                onClick = {
                    if (prompt.isBlank() || streaming) return@Button
                    error = null
                    reply = ""
                    streaming = true
                    val body = textPromptBody(Constants.DEFAULT_MODEL, prompt)
                    scope.launch {
                        try {
                            lwc.chat(body).collect { reply += it }
                        } catch (e: Exception) {
                            error = e.message ?: "Request failed."
                        } finally {
                            streaming = false
                        }
                    }
                },
                enabled = !streaming,
            ) { Text(if (streaming) "Streaming…" else "Send") }

            OutlinedButton(onClick = onLogout) { Text("Log out") }
        }

        Spacer(Modifier.height(16.dp))
        if (error != null) {
            Text(error!!, color = MaterialTheme.colorScheme.error)
            Spacer(Modifier.height(8.dp))
        }
        Text(
            reply,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
        )
    }
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Box(modifier = Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        content()
    }
}
