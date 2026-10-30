package ru.lastochka.config

import org.springframework.boot.CommandLineRunner
import org.springframework.boot.SpringApplication
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.ConfigurableApplicationContext
import org.springframework.stereotype.Component
import ru.lastochka.common.Metadata
import ru.lastochka.identity.service.AdminAccessService

@Component
@ConditionalOnProperty(name = ["lastochka.admin.configure"], havingValue = "true")
class AdminAccessBootstrap(
    private val service: AdminAccessService,
    private val context: ConfigurableApplicationContext,
) : CommandLineRunner {
    override fun run(vararg args: String) {
        val id =
            java.util.UUID.fromString(requireNotNull(System.getenv(Metadata.Concept.ADMIN_ID_ENV)))
        System.getenv(Metadata.Concept.ADMIN_LOGIN_ENV)?.let { service.provision(id, it) }
        System.getenv(Metadata.Protocol.LASTOCHKA_ADMIN_PASSWORD)?.let { service.reset(id, it) }
        SpringApplication.exit(context)
    }
}
