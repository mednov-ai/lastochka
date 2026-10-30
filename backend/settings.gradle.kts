pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

rootProject.name = "lastochka"

include(
    "app",
    "common",
    "identity",
    "scheduling",
    "notifications",
    "content",
    "payments",
    "enquiries",
)
