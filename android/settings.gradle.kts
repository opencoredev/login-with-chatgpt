pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "login-with-chatgpt-android"

// lwc-core is pure Kotlin/JVM. lwc-android + sample add the Android layer + demo app.
include(":lwc-core")
include(":lwc-android")
include(":sample")
