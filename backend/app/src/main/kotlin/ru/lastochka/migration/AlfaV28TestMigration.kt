package ru.lastochka.migration

import java.nio.file.Files
import java.nio.file.Path
import java.sql.DriverManager
import org.flywaydb.core.Flyway
import ru.lastochka.common.Metadata
import kotlin.system.exitProcess

/** Separate operator-run migrator; never enables Flyway in the runtime application. */
object AlfaV28TestMigration {
    @JvmStatic fun main(args: Array<String>) {
        try {
            require(args.isEmpty())
            val zone = System.getenv(Metadata.AlfaMigration.ZONE)
            val identifier = System.getenv(Metadata.AlfaMigration.IDENTIFIER).orEmpty()
            val url = System.getenv(Metadata.AlfaMigration.DB_URL)
            val user = System.getenv(Metadata.AlfaMigration.DB_USER)
            val passwordFile = Path.of(System.getenv(Metadata.AlfaMigration.PASSWORD_FILE).orEmpty())
            require(zone == "test" && identifier.matches(Regex(Metadata.AlfaMigration.IDENTIFIER_PATTERN)))
            require(url == "jdbc:postgresql://postgres:5432/lastochka" && user == "lastochka_migrator")
            require(Files.isRegularFile(passwordFile) && Files.size(passwordFile) in 1..Metadata.AlfaPayment.SECRET_MAX_BYTES)
            require(!System.getenv(Metadata.AlfaMigration.KEY_DIRECTORY).isNullOrBlank())
            val password = Files.readString(passwordFile).trimEnd('\r', '\n')
            DriverManager.getConnection(url, user, password).use { connection ->
                connection.prepareStatement("SELECT environment, identifier FROM deploy_guard.identity").use { statement ->
                    statement.executeQuery().use { rows ->
                        check(rows.next() && rows.getString(1) == zone && rows.getString(Metadata.AlfaMigration.SECOND_COLUMN) == identifier && !rows.next())
                    }
                }
                connection.prepareStatement("SELECT current_user, rolsuper FROM pg_roles WHERE rolname=current_user").use { statement ->
                    statement.executeQuery().use { rows ->
                        check(rows.next() && rows.getString(1) == user && !rows.getBoolean(Metadata.AlfaMigration.SECOND_COLUMN) && !rows.next())
                    }
                }
            }
            val flyway = Flyway.configure().dataSource(url, user, password).locations("classpath:db/migration")
                .target("28").cleanDisabled(true).baselineOnMigrate(false).load()
            check(flyway.info().current()?.version?.version == "27")
            flyway.migrate()
            check(flyway.info().current()?.version?.version == "28")
            println("Verified test database migrated to V28")
        } catch (_: Exception) {
            System.err.println("Test V28 migration refused or failed; inspect the protected target before retrying")
            exitProcess(1)
        }
    }
}
