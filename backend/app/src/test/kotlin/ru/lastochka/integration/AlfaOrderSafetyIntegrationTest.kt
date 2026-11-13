package ru.lastochka.integration

import java.time.Clock
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.WebApplicationType
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.builder.SpringApplicationBuilder
import org.springframework.context.ApplicationContextInitializer
import org.springframework.context.ConfigurableApplicationContext
import org.springframework.core.env.Environment
import org.springframework.mock.env.MockEnvironment
import org.springframework.test.context.ContextConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.web.server.ResponseStatusException
import org.testcontainers.postgresql.PostgreSQLContainer
import ru.lastochka.common.service.CommandService
import ru.lastochka.identity.service.AccountService
import ru.lastochka.identity.service.StaffAccessService
import ru.lastochka.payments.alfa.AlfaGatewaySelection
import ru.lastochka.payments.alfa.*
import ru.lastochka.payments.dto.PaymentInput
import ru.lastochka.payments.repo.AlfaTestAttemptQueries
import ru.lastochka.payments.repo.PaymentRepository
import ru.lastochka.payments.service.AlfaTestPaymentService
import ru.lastochka.payments.service.PaymentService
import ru.lastochka.LastochkaApplication

@ActiveProfiles("test")
@SpringBootTest(properties = ["lastochka.workers.enabled=false"])
@ContextConfiguration(initializers = [AlfaOrderSafetyIntegrationTest.TestDatabaseGuard::class])
class AlfaOrderSafetyIntegrationTest {
    companion object {
        private val db = PostgreSQLContainer("postgres:17.6-alpine").apply { start() }
        @JvmStatic @DynamicPropertySource fun database(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url") { db.jdbcUrl }
            registry.add("spring.datasource.username") { db.username }
            registry.add("spring.datasource.password") { db.password }
        }
        @JvmStatic @AfterAll fun stop() = db.stop()
    }

    /** Runs before bean creation and Flyway, including every explicitly restarted context. */
    class TestDatabaseGuard : ApplicationContextInitializer<ConfigurableApplicationContext> {
        override fun initialize(context: ConfigurableApplicationContext) {
            context.addBeanFactoryPostProcessor { validate(context.environment) }
        }

        fun validate(environment: Environment) {
            check(environment.getProperty("spring.datasource.url") == db.jdbcUrl) { "Refusing any non-fixture datasource" }
            check(environment.getProperty("spring.datasource.username") == db.username) { "Refusing unexpected database user" }
            val flywayUrl = environment.getProperty("spring.flyway.url")
            check(flywayUrl.isNullOrBlank() || flywayUrl == db.jdbcUrl) { "Refusing separate Flyway datasource" }
        }
    }

    @Test fun `database guard rejects nonfixture datasource before context startup`() {
        val environment = MockEnvironment().withProperty("spring.datasource.url", "jdbc:postgresql://localhost:55432/lastochka")
            .withProperty("spring.datasource.username", db.username)
        assertThrows(IllegalStateException::class.java) { TestDatabaseGuard().validate(environment) }
        environment.setProperty("spring.datasource.url", db.jdbcUrl)
        environment.setProperty("spring.flyway.url", "jdbc:postgresql://localhost:55432/lastochka")
        assertThrows(IllegalStateException::class.java) { TestDatabaseGuard().validate(environment) }
    }

    @Test fun `restarted context refuses a nonfixture database before Flyway`() {
        val error = assertThrows(Exception::class.java) {
            SpringApplicationBuilder(LastochkaApplication::class.java)
                .web(WebApplicationType.NONE)
                .profiles("test")
                .initializers(TestDatabaseGuard())
                .run(
                    "--spring.datasource.url=jdbc:postgresql://localhost:55432/lastochka",
                    "--spring.datasource.username=${db.username}",
                    "--lastochka.workers.enabled=false",
                ).close()
        }
        assertTrue(generateSequence(error as Throwable?) { it.cause }.any {
            it.message?.contains("Refusing any non-fixture datasource") == true
        })
    }

    @Autowired lateinit var accounts: AccountService
    @Autowired lateinit var payments: PaymentService
    @Autowired lateinit var storage: PaymentRepository
    @Autowired lateinit var attempts: AlfaTestAttemptQueries
    @Autowired lateinit var commands: CommandService
    @Autowired lateinit var access: StaffAccessService
    @Autowired lateinit var transactions: PlatformTransactionManager
    @Autowired lateinit var jdbc: JdbcClient

    class Bank : AlfaBankGateway {
        val registers = AtomicInteger()
        val statuses = AtomicInteger()
        @Volatile var failRegister = false
        @Volatile var noUrl = false
        @Volatile var registrationCode: String? = "0"
        @Volatile var registrationOrderId: String? = "bank-order"
        @Volatile var currentNumber: String? = null
        @Volatile var statusAction: (String?, String?) -> AlfaStatusResult = { orderId, number ->
            AlfaStatusResult(number, orderId, 12345, "643", 0, "0")
        }
        override fun register(credentials: AlfaCredentials, orderNumber: String, amountMinor: Long, returnUrl: String): AlfaRegisterResult {
            registers.incrementAndGet(); currentNumber = orderNumber
            if (failRegister) throw IllegalStateException("synthetic lost response")
            return AlfaRegisterResult(registrationOrderId, if (noUrl) null else "https://test.example/link", registrationCode)
        }
        override fun status(credentials: AlfaCredentials, orderId: String?, orderNumber: String?): AlfaStatusResult {
            statuses.incrementAndGet(); return statusAction(orderId, orderNumber)
        }
        override fun decline(credentials: AlfaCredentials, orderId: String?, orderNumber: String?) = AlfaDeclineResult("0")
    }


    private fun selectedTest(): AlfaGatewaySelection = mock(AlfaGatewaySelection::class.java).also {
        `when`(it.testSelected()).thenReturn(true)
    }

    private fun admin(): UUID = accounts.createAdmin("p" + UUID.randomUUID().toString().take(8), "Fixture", "Fixture-password-2026").id
    private fun draft(actor: UUID) = payments.save(actor, null, PaymentInput(12345, "Fixture", "Fixture", "+79001234567"))
    private fun version(actor: UUID): UUID {
        val id = UUID.randomUUID()
        jdbc.sql("INSERT INTO alfa_credentials_versions(id,ciphertext,created_at,created_by) VALUES(:id,decode('00','hex'),now(),:actor)")
            .param("id", id).param("actor", actor).update()
        return id
    }
    private fun service(version: UUID, bank: Bank): AlfaTestPaymentService {
        val config = mock(AlfaConfigurationService::class.java)
        `when`(config.activeVersion()).thenReturn(version)
        `when`(config.credentials(version)).thenReturn(AlfaCredentials("fixture-login", "fixture-password", "fixture-merchant"))
        `when`(config.validFormUrl("https://test.example/link")).thenReturn(true)
        `when`(config.encryptLink("https://test.example/link")).thenReturn(byteArrayOf(1, 2, 3))
        return AlfaTestPaymentService(attempts, storage, config, bank, commands, access, Clock.systemUTC(), transactions,
            "https://test.example/lastochka/payments/test/return", "https://test.example", true, selectedTest())
    }

    @Test fun `two different administrators and a completed order never create a second bank order`() {
        val firstActor = admin(); val secondActor = admin(); val bank = Bank()
        val version = version(firstActor); val payment = draft(firstActor); val service = service(version, bank)
        val one = CompletableFuture.supplyAsync { service.issue(firstActor, payment.id, payment.version) }
        val two = CompletableFuture.supplyAsync { service.issue(secondActor, payment.id, payment.version) }
        CompletableFuture.allOf(one, two).join()
        assertEquals(1, bank.registers.get())
        jdbc.sql("UPDATE alfa_test_attempts SET operation_state='PAID',bank_status='PAID',archived=true WHERE payment_id=:id")
            .param("id", payment.id).update()
        val resumed = service(version, bank).issue(secondActor, payment.id, payment.version)
        assertEquals("PAID", resumed.operationState)
        assertEquals(1, bank.registers.get())
    }

    @Test fun `lost response and not found remain unresolved across service reconstruction`() {
        val actor = admin(); val version = version(actor); val payment = draft(actor); val bank = Bank().apply { failRegister = true }
        val first = service(version, bank)
        assertEquals("UNKNOWN", first.issue(actor, payment.id, payment.version).operationState)
        val number = bank.currentNumber
        bank.statusAction = { orderId, orderNumber ->
            assertNull(orderId); assertEquals(number, orderNumber)
            AlfaStatusResult(null, null, null, null, null, "6")
        }
        val recreated = service(version, bank)
        assertEquals("UNKNOWN", recreated.refresh(actor, payment.id, payment.version).operationState)
        assertEquals("UNKNOWN", recreated.issue(actor, payment.id, payment.version).operationState)
        assertEquals(1, bank.registers.get())
        assertFalse(storage.find(payment.id)!!.linkAvailable)
    }

    @Test fun `lost registration is not duplicated after restarting backend context on the same database`() {
        val actor = admin(); val version = version(actor); val payment = draft(actor); val bank = Bank().apply { failRegister = true }
        RestartOverrides.bank = bank; RestartOverrides.configVersion = version
        fun start() = SpringApplicationBuilder(LastochkaApplication::class.java, RestartOverrides::class.java)
            .profiles("test")
            .initializers(TestDatabaseGuard())
            .run(
                "--server.port=0", "--spring.datasource.url=${db.jdbcUrl}",
                "--spring.datasource.username=${db.username}", "--spring.datasource.password=${db.password}",
                "--lastochka.workers.enabled=false",
                "--lastochka.alfa.return-url=https://test.example/lastochka/payments/test/return",
                "--lastochka.origin=https://test.example",
                "--lastochka.alfa.decline-confirmed=true",
            )
        start().use { context ->
            val restartedService = context.getBean(AlfaTestPaymentService::class.java)
            assertEquals("UNKNOWN", restartedService.issue(actor, payment.id, payment.version).operationState)
        }
        val number = bank.currentNumber
        bank.statusAction = { orderId, orderNumber ->
            assertNull(orderId); assertEquals(number, orderNumber)
            AlfaStatusResult(null, null, null, null, null, "6")
        }
        start().use { context ->
            val restartedService = context.getBean(AlfaTestPaymentService::class.java)
            assertEquals("UNKNOWN", restartedService.refresh(actor, payment.id, payment.version).operationState)
            assertEquals("UNKNOWN", restartedService.issue(actor, payment.id, payment.version).operationState)
        }
        assertEquals(1, bank.registers.get())
    }

    @Test fun `registered order without URL never invents a payment link`() {
        val actor = admin(); val version = version(actor); val payment = draft(actor); val bank = Bank().apply { noUrl = true }
        val service = service(version, bank)
        assertEquals("OPEN", service.issue(actor, payment.id, payment.version).operationState)
        assertFalse(storage.find(payment.id)!!.linkAvailable)
        assertThrows(ResponseStatusException::class.java) { service.link(actor, payment.id) }
        assertEquals(1, bank.registers.get())
    }

    @Test fun `missing registration error code with an order id stays unpaid until 810 status confirms it`() {
        val actor = admin(); val version = version(actor); val payment = draft(actor)
        val bank = Bank().apply { registrationCode = null }
        val service = service(version, bank)
        val issued = service.issue(actor, payment.id, payment.version)
        assertEquals("OPEN", issued.operationState)
        assertTrue(issued.linkAvailable)
        assertNull(issued.bankStatus)
        bank.statusAction = { orderId, number -> AlfaStatusResult(number, orderId, 12345, "810", 2, "0") }
        val confirmed = service.refresh(actor, payment.id, payment.version)
        assertEquals("PAID", confirmed.operationState)
        assertEquals("PAID", confirmed.bankStatus)
    }

    @Test fun `missing code without order id or explicit error never exposes a link`() {
        val actor = admin(); val version = version(actor)
        for ((code, id) in listOf(null to null, "3" to "bank-order")) {
            val payment = draft(actor)
            val bank = Bank().apply { registrationCode = code; registrationOrderId = id }
            val result = service(version, bank).issue(actor, payment.id, payment.version)
            assertEquals("UNKNOWN", result.operationState)
            assertFalse(result.linkAvailable)
            assertNull(result.bankStatus)
        }
    }

    @Test fun `mismatched order amount and currency cannot produce confirmed payment`() {
        val actor = admin(); val version = version(actor); val payment = draft(actor); val bank = Bank(); val service = service(version, bank)
        service.issue(actor, payment.id, payment.version)
        val number = bank.currentNumber
        val mismatches = listOf(
            AlfaStatusResult("other-number", "other-order", 12345, "643", 2, "0"),
            AlfaStatusResult(number, "bank-order", 12346, "643", 2, "0"),
            AlfaStatusResult(number, "bank-order", 12345, "840", 2, "0"),
        )
        for (response in mismatches) {
            bank.statusAction = { _, _ -> response }
            val result = service.refresh(actor, payment.id, payment.version)
            assertNotEquals("PAID", result.operationState)
            assertNull(result.bankStatus)
            assertNull(result.bankCheckedAt)
            assertNotNull(result.bankError)
        }
        bank.statusAction = { _, _ -> AlfaStatusResult(number, "bank-order", 12345, "643", 2, "0") }
        assertEquals("PAID", service.refresh(actor, payment.id, payment.version).operationState)
    }

    @Test fun `late status response cannot overwrite cancellation confirmed by concurrent command`() {
        val actor = admin(); val version = version(actor); val payment = draft(actor); val bank = Bank(); val service = service(version, bank)
        service.issue(actor, payment.id, payment.version)
        service.refresh(actor, payment.id, payment.version)
        assertEquals("REGISTERED", storage.find(payment.id)!!.bankStatus)
        val entered = CountDownLatch(1); val release = CountDownLatch(1)
        bank.statusAction = { orderId, number ->
            entered.countDown(); check(release.await(10, TimeUnit.SECONDS))
            AlfaStatusResult(number, orderId, 12345, "643", 0, "0")
        }
        val slow = CompletableFuture.supplyAsync { service.refresh(actor, payment.id, payment.version) }
        try {
            assertTrue(entered.await(10, TimeUnit.SECONDS))
            val cancelled = service.cancel(actor, payment.id, payment.version)
            assertEquals("CANCELLED", cancelled.operationState)
        } finally { release.countDown() }
        slow.get(10, TimeUnit.SECONDS)
        val final = storage.find(payment.id)!!
        assertEquals("CANCELLED", final.operationState)
        assertEquals("CANCELLED", final.bankStatus)
        assertTrue(final.archived)
    }
}

@TestConfiguration(proxyBeanMethods = false)
class RestartOverrides {
    companion object {
        lateinit var bank: AlfaOrderSafetyIntegrationTest.Bank
        lateinit var configVersion: UUID
    }
    @Bean @Primary fun restartBank(): AlfaBankGateway = bank
    @Bean @Primary fun restartConfig(): AlfaConfigurationService {
        val config = mock(AlfaConfigurationService::class.java)
        `when`(config.activeVersion()).thenReturn(configVersion)
        `when`(config.credentials(configVersion)).thenReturn(AlfaCredentials("fixture-login", "fixture-password", "fixture-merchant"))
        `when`(config.validFormUrl("https://test.example/link")).thenReturn(true)
        `when`(config.encryptLink("https://test.example/link")).thenReturn(byteArrayOf(1, 2, 3))
        return config
    }
}
