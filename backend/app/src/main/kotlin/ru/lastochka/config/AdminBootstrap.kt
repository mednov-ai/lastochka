package ru.lastochka.config

import org.springframework.boot.CommandLineRunner
import org.springframework.boot.SpringApplication
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.ConfigurableApplicationContext
import org.springframework.stereotype.Component
import ru.lastochka.common.Metadata
import ru.lastochka.identity.service.AccountService

@Component
@ConditionalOnProperty(name = ["lastochka.admin.create"], havingValue = "true")
class AdminBootstrap(
    private val accounts: AccountService,
    private val context: ConfigurableApplicationContext,
) : CommandLineRunner {
    override fun run(vararg args: String) {
        fun env(name: String) = requireNotNull(System.getenv(name)) { "Missing $name" }
        accounts.createAdmin(
            env(Metadata.Concept.ADMIN_LOGIN_ENV),
            env(Metadata.Protocol.LASTOCHKA_ADMIN_NAME),
            env(Metadata.Protocol.LASTOCHKA_ADMIN_PASSWORD),
        )
        SpringApplication.exit(context)
    }
}
