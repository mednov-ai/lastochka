package ru.lastochka.config

import java.net.URI
import org.springframework.context.ApplicationContextInitializer
import org.springframework.context.ConfigurableApplicationContext
import ru.lastochka.common.Metadata

/** Fail before Flyway/bean creation when a test-only deployment is misconfigured. */
class PreviewEnvironmentInitializer :
    ApplicationContextInitializer<ConfigurableApplicationContext> {
    override fun initialize(context: ConfigurableApplicationContext) {
        val env = context.environment
        val url = URI(env.getProperty("lastochka.public-url") ?: "http://localhost:5173/lastochka/")
        val origin = env.getProperty("lastochka.origin") ?: "http://localhost:5173"
        val rp = env.getProperty("lastochka.rp-id") ?: "localhost"
        val base = env.getProperty("server.servlet.context-path") ?: Metadata.Routes.LASTOCHKA
        require(url.host != null && url.path == "${base.trimEnd('/')}/") {
            "Public URL must match the application base path"
        }
        val expected = "${url.scheme}://${url.host}" + (if (url.port < 0) "" else ":${url.port}")
        require(origin == expected && rp == url.host) {
            "Explicit WebAuthn origin/RP must match the public URL"
        }
        val local = url.host in setOf("localhost", "127.0.0.1", "[::1]")
        require(url.scheme == "https" || url.scheme == "http" && local) {
            "Remote preview requires HTTPS"
        }
        if (!local) {
            val generation =
                env.getProperty(
                    Metadata.Concept.ACCESS_GENERATION_SETTING,
                    Metadata.Concept.LOCAL_GENERATION,
                )
            require(
                generation.length >= Metadata.Concept.MIN_GENERATION_LENGTH &&
                    !generation.startsWith("replace-with")
            ) {
                "Remote concept requires an external access generation"
            }
            require(
                env.getProperty("server.servlet.session.cookie.secure", Boolean::class.java, false)
            ) {
                "Remote preview requires Secure cookies"
            }
        }
    }
}
