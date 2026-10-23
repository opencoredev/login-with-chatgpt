plugins {
    // Versions are declared once in the root build (apply false).
    kotlin("jvm")
    kotlin("plugin.serialization")
    application
}

group = "com.opencoredev.loginwithchatgpt"
version = "0.1.0"

dependencies {
    // These types appear in the public API (OkHttpClient in config, Flow<String>
    // from codexResponses, JsonObject in params), so expose them transitively.
    api("com.squareup.okhttp3:okhttp:4.12.0")
    api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    api("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")

    testImplementation(kotlin("test"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
}

kotlin {
    jvmToolchain(17)
}

tasks.test {
    useJUnitPlatform()
}

application {
    // Stage 0 spike entrypoint: `gradle :lwc-core:run`
    mainClass.set("com.opencoredev.loginwithchatgpt.SpikeKt")
}
