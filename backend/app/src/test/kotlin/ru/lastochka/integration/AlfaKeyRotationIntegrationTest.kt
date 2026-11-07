package ru.lastochka.integration

import java.nio.file.Files
import java.util.Base64
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import org.testcontainers.postgresql.PostgreSQLContainer
import ru.lastochka.common.service.CommandService
import ru.lastochka.payments.alfa.AlfaConfigurationService
import ru.lastochka.payments.alfa.AlfaSecretBox

@ActiveProfiles("test")
@SpringBootTest(properties = ["lastochka.workers.enabled=false"])
class AlfaKeyRotationIntegrationTest {
    companion object {
        private val db = PostgreSQLContainer("postgres:17.6-alpine").apply { start() }
        private val keys = Files.createTempDirectory("alfa-key-rotation-test-").apply {
            Files.writeString(resolve("old.key"), Base64.getEncoder().encodeToString(ByteArray(32) { it.toByte() }))
            Files.writeString(resolve("new.key"), Base64.getEncoder().encodeToString(ByteArray(32) { (it + 7).toByte() }))
        }

        @JvmStatic @DynamicPropertySource
        fun properties(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url") { db.jdbcUrl }
            registry.add("spring.datasource.username") { db.username }
            registry.add("spring.datasource.password") { db.password }
            registry.add("lastochka.alfa.key-directory") { keys.toString() }
            registry.add("lastochka.alfa.key-id") { "old" }
        }

        @JvmStatic @AfterAll fun close() {
            db.stop()
            Files.deleteIfExists(keys.resolve("old.key")); Files.deleteIfExists(keys.resolve("new.key")); Files.deleteIfExists(keys)
        }
    }

    @Autowired lateinit var jdbc: JdbcClient
    @Autowired lateinit var config: AlfaConfigurationService
    @Autowired lateinit var box: AlfaSecretBox
    @Autowired lateinit var commands: CommandService
    @Autowired lateinit var manager: PlatformTransactionManager

    @Test
    fun `rotation rolls back on bad ciphertext, serializes with writes and fences the old process`() {
        val actor = UUID.randomUUID(); val first = UUID.randomUUID(); val second = UUID.randomUUID()
        val payment = UUID.randomUUID()
        jdbc.sql("INSERT INTO accounts(id,email,name,password_hash,role) VALUES(:id,:email,'Fixture','x','ADMIN')")
            .param("id", actor).param("email", "$actor@fixture.test").update()
        jdbc.sql("UPDATE alfa_configuration SET current_key_id='old',candidate_version=NULL WHERE id=1").update()
        val firstPlain = "fixture-credentials-one".toByteArray(); val secondPlain = "fixture-credentials-two".toByteArray()
        val firstCipher = box.seal(firstPlain, "credentials"); val secondCipher = box.seal(secondPlain, "credentials")
        for ((id, cipher) in listOf(first to firstCipher, second to secondCipher)) {
            jdbc.sql("INSERT INTO alfa_credentials_versions(id,ciphertext,created_at,created_by) VALUES(:id,:bytes,now(),:actor)")
                .param("id", id).param("bytes", cipher).param("actor", actor).update()
        }
        jdbc.sql("INSERT INTO payment_requests(id,amount_minor,purpose,recipient_name,phone,created_by) VALUES(:id,100,'test','Fixture','+79000000000',:actor)")
            .param("id", payment).param("actor", actor).update()
        jdbc.sql("INSERT INTO alfa_test_attempts(payment_id,config_version,order_number,draft_version,amount_minor,purpose,operation_state,link_ciphertext) VALUES(:id,:version,:order,0,100,'test','OPEN',:link)")
            .param("id", payment).param("version", first).param("order", payment.toString())
            .param("link", box.seal("original".toByteArray(), "link")).update()

        val corrupt = secondCipher.copyOf().also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() }
        jdbc.sql("UPDATE alfa_credentials_versions SET ciphertext=:bytes WHERE id=:id").param("bytes", corrupt).param("id", second).update()
        assertThrows(Exception::class.java) { config.rotateKey(actor, "new") }
        assertEquals("old", jdbc.sql("SELECT current_key_id FROM alfa_configuration WHERE id=1").query(String::class.java).single())
        assertArrayEquals(firstCipher, jdbc.sql("SELECT ciphertext FROM alfa_credentials_versions WHERE id=:id").param("id", first).query(ByteArray::class.java).single())
        jdbc.sql("UPDATE alfa_credentials_versions SET ciphertext=:bytes WHERE id=:id").param("bytes", secondCipher).param("id", second).update()

        val acquired = CountDownLatch(1); val release = CountDownLatch(1); val pool = Executors.newFixedThreadPool(2)
        try {
            val writer = pool.submit {
                TransactionTemplate(manager).execute {
                    commands.lockStudio(); acquired.countDown(); check(release.await(10, TimeUnit.SECONDS))
                    val value = config.encryptLink("written-before-rotation")
                    jdbc.sql("UPDATE alfa_test_attempts SET link_ciphertext=:value WHERE payment_id=:id").param("value", value).param("id", payment).update()
                }
            }
            assertTrue(acquired.await(10, TimeUnit.SECONDS))
            val rotation = pool.submit { config.rotateKey(actor, "new") }
            release.countDown(); writer.get(20, TimeUnit.SECONDS); rotation.get(20, TimeUnit.SECONDS)
        } finally { release.countDown(); pool.shutdownNow() }

        assertEquals("new", jdbc.sql("SELECT current_key_id FROM alfa_configuration WHERE id=1").query(String::class.java).single())
        val newBox = AlfaSecretBox(keys.toString(), "new")
        for ((id, expected) in listOf(first to firstPlain, second to secondPlain)) {
            val value = jdbc.sql("SELECT ciphertext FROM alfa_credentials_versions WHERE id=:id").param("id", id).query(ByteArray::class.java).single()
            assertArrayEquals(expected, newBox.open(value, "credentials"))
        }
        val link = jdbc.sql("SELECT link_ciphertext FROM alfa_test_attempts WHERE payment_id=:id").param("id", payment).query(ByteArray::class.java).single()
        assertEquals("written-before-rotation", newBox.open(link, "link").toString(Charsets.UTF_8))
        val backup = Files.createTempDirectory("alfa-key-backup-test-")
        try {
            Files.copy(keys.resolve("new.key"), backup.resolve("new.key"))
            val storedDatabaseCiphertext = link.copyOf()
            Files.delete(keys.resolve("new.key"))
            assertThrows(Exception::class.java) { newBox.open(storedDatabaseCiphertext, "link") }
            Files.copy(backup.resolve("new.key"), keys.resolve("new.key"))
            assertEquals("written-before-rotation", newBox.open(storedDatabaseCiphertext, "link").toString(Charsets.UTF_8))
        } finally { Files.deleteIfExists(backup.resolve("new.key")); Files.deleteIfExists(backup) }
        assertThrows(Exception::class.java) {
            TransactionTemplate(manager).execute { commands.lockStudio(); config.encryptLink("late-old-process") }
        }
    }
}
