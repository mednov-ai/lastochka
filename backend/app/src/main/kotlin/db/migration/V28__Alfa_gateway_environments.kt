package db.migration

import java.util.zip.CRC32
import org.flywaydb.core.api.migration.BaseJavaMigration
import org.flywaydb.core.api.migration.Context
import ru.lastochka.payments.alfa.AlfaSecretBox
import ru.lastochka.common.Metadata

/** Verify every legacy envelope and hold write locks until the schema change commits. */
class V28__Alfa_gateway_environments : BaseJavaMigration() {
    private val script: ByteArray by lazy {
        requireNotNull(javaClass.getResourceAsStream("/repo/alfa/V28__alfa_gateway_environments.sql")) {
            "Alfa V28 migration resource is unavailable"
        }.use { it.readAllBytes() }
    }

    override fun getChecksum(): Int = CRC32().apply { update(script) }.value.toInt()

    override fun migrate(context: Context) {
        val connection = context.connection
        connection.createStatement().use { statement ->
            statement.execute("LOCK TABLE alfa_configuration, alfa_credentials_versions, alfa_test_attempts IN ACCESS EXCLUSIVE MODE")
        }
        val keyDirectory = System.getenv(Metadata.AlfaMigration.KEY_DIRECTORY).orEmpty()
        val box = AlfaSecretBox(keyDirectory, "")
        try {
            verifyColumn(context, box, "SELECT ciphertext FROM alfa_credentials_versions", "credentials")
            verifyColumn(context, box, "SELECT link_ciphertext FROM alfa_test_attempts WHERE link_ciphertext IS NOT NULL", "link")
        } catch (failure: Exception) {
            // Never log ciphertext, plaintext, key identifiers, or exception details.
            throw IllegalStateException("Alfa V28 requires verifiable legacy TEST credentials and links")
        }
        connection.createStatement().use { it.execute(script.toString(Charsets.UTF_8)) }
    }

    private fun verifyColumn(context: Context, box: AlfaSecretBox, sql: String, purpose: String) {
        context.connection.createStatement().use { statement ->
            statement.executeQuery(sql).use { rows ->
                while (rows.next()) {
                    val plain = box.open(rows.getBytes(1), purpose)
                    plain.fill(0)
                }
            }
        }
    }
}
