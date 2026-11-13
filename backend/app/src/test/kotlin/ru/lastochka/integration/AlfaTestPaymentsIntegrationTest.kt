package ru.lastochka.integration

import java.time.Clock
import java.nio.file.Files
import java.nio.file.Path
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.Base64
import java.util.HexFormat
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.mockito.Mockito.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import org.testcontainers.postgresql.PostgreSQLContainer
import ru.lastochka.common.service.CommandService
import ru.lastochka.identity.service.AccountService
import ru.lastochka.identity.service.StaffAccessService
import ru.lastochka.identity.security.StaffPermissionPolicy
import ru.lastochka.payments.alfa.AlfaGatewaySelection
import ru.lastochka.payments.alfa.*
import ru.lastochka.payments.dto.PaymentInput
import ru.lastochka.payments.repo.AlfaTestAttemptQueries
import ru.lastochka.payments.repo.PaymentRepository
import ru.lastochka.payments.service.AlfaTestPaymentService
import ru.lastochka.payments.service.AlfaCallbackService
import ru.lastochka.payments.service.PaymentService
import tools.jackson.databind.json.JsonMapper

@ActiveProfiles("test")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = ["lastochka.workers.enabled=false"])
class AlfaTestPaymentsIntegrationTest {
    @TempDir lateinit var directory: Path
    companion object {
        private val db = PostgreSQLContainer("postgres:17.6-alpine").apply { start() }
        @JvmStatic @DynamicPropertySource fun database(r: DynamicPropertyRegistry) {
            r.add("spring.datasource.url") { db.jdbcUrl }
            r.add("spring.datasource.username") { db.username }
            r.add("spring.datasource.password") { db.password }
        }
    }

    @Autowired lateinit var jdbc: JdbcClient
    @Autowired lateinit var accounts: AccountService
    @Autowired lateinit var payments: PaymentService
    @Autowired lateinit var storage: PaymentRepository
    @Autowired lateinit var attempts: AlfaTestAttemptQueries
    @Autowired lateinit var commands: CommandService
    @Autowired lateinit var access: StaffAccessService
    @Autowired lateinit var transactions: PlatformTransactionManager
    @Autowired lateinit var json: JsonMapper
    @LocalServerPort var port: Int = 0

    private class FakeBank : AlfaBankGateway {
        var declineResult: AlfaDeclineResult? = AlfaDeclineResult("0")
        var declines = 0
        var duringDecline: (() -> Unit)? = null
        var duringRegister: ((String) -> Unit)? = null
        val registrations = AtomicInteger()
        val returnUrls = CopyOnWriteArrayList<String>()
        val statusCalls = AtomicInteger()
        val statusOrders = CopyOnWriteArrayList<String>()
        var registrationFails = false
        override fun register(credentials: AlfaCredentials, orderNumber: String, amountMinor: Long, returnUrl: String): AlfaRegisterResult {
            registrations.incrementAndGet()
            returnUrls.add(returnUrl)
            Thread.sleep(100)
            duringRegister?.invoke(orderNumber)
            if (registrationFails) throw IllegalStateException("network")
            return AlfaRegisterResult("bank-id", "https://test.example/link", "0")
        }
        override fun decline(credentials: AlfaCredentials, orderId: String?, orderNumber: String?): AlfaDeclineResult {
            declines++
            duringDecline?.invoke()
            return declineResult ?: throw IllegalStateException("network")
        }
        override fun status(credentials: AlfaCredentials, orderId: String?, orderNumber: String?): AlfaStatusResult {
            statusCalls.incrementAndGet()
            if (orderNumber != null) statusOrders.add(orderNumber)
            return AlfaStatusResult(orderNumber, orderId, 12345, "643", 0, "0")
        }
    }

    private fun selectedTest(): AlfaGatewaySelection = mock(AlfaGatewaySelection::class.java).also {
        `when`(it.testSelected()).thenReturn(true)
    }

    private fun admin() = accounts.createAdmin("t" + UUID.randomUUID().toString().take(8), "Администратор", "Valid-pass-2026")
    private fun draft(actor: UUID) = payments.save(actor, null, PaymentInput(12345, "Тест", "Родитель", "+79001234567"))
    private fun credentialVersion(actor: UUID): UUID {
        val id = UUID.randomUUID()
        jdbc.sql("INSERT INTO alfa_credentials_versions(id,ciphertext,created_at,created_by) VALUES(:id,decode('00','hex'),now(),:actor)")
            .param("id", id).param("actor", actor).update()
        return id
    }
    private fun insertAttempt(payment: UUID, version: UUID, status: String = "OPEN", bankStatus: String = "REGISTERED", rejected: Boolean = false) {
        jdbc.sql("""INSERT INTO alfa_test_attempts(payment_id,config_version,order_number,order_id,draft_version,amount_minor,purpose,operation_state,bank_status,rejected_at)
            VALUES(:payment,:version,:number,:orderId,0,12345,'Тест',:status,:bankStatus,CASE WHEN :rejected THEN now()-interval '8 days' ELSE NULL END)""")
            .param("payment", payment).param("version", version).param("number", payment.toString())
            .param("orderId", payment.toString()).param("status", status).param("bankStatus", bankStatus).param("rejected", rejected).update()
    }
    private fun service(version: UUID, bank: FakeBank, enabled: Boolean = true,
                        returnUrl: String = "https://test.example/lastochka/payments/test/return",
                        origin: String = "https://test.example"): AlfaTestPaymentService {
        val config = mock(AlfaConfigurationService::class.java)
        `when`(config.activeVersion()).thenReturn(if (enabled) version else null)
        `when`(config.credentials(version)).thenReturn(AlfaCredentials("test-login", "test-password", "test-merchant"))
        `when`(config.validFormUrl("https://test.example/link")).thenReturn(true)
        `when`(config.encryptLink("https://test.example/link")).thenReturn(byteArrayOf(1, 2, 3))
        return AlfaTestPaymentService(attempts, storage, config, bank, commands, access, Clock.systemUTC(), transactions, returnUrl, origin, true, selectedTest())
    }

    @Test fun `bank-confirmed cancellation archives while ambiguous outcome remains active`() {
        val actor = admin().id
        val version = credentialVersion(actor)
        val ok = draft(actor)
        val ambiguous = draft(actor)
        insertAttempt(ok.id, version)
        insertAttempt(ambiguous.id, version)
        val bank = FakeBank()
        val service = service(version, bank)
        val result = service.cancel(actor, ok.id, ok.version)
        assertEquals("CANCELLED", result.operationState)
        assertTrue(result.archived)
        assertEquals(1, bank.declines)
        bank.declineResult = null
        val unknown = service.cancel(actor, ambiguous.id, ambiguous.version)
        assertEquals("CANCEL_UNKNOWN", unknown.operationState)
        assertFalse(unknown.archived)
        assertEquals(2, bank.declines)
        service.cancel(actor, ambiguous.id, ambiguous.version)
        assertEquals(2, bank.declines)
    }

    @Test fun `active and archived pages are independent and expired rejection archives locally`() {
        val actor = admin().id
        val version = credentialVersion(actor)
        val before = storage.page(0, "ACTIVE").total
        repeat(21) { draft(actor) }
        val first = storage.page(0, "ACTIVE")
        val second = storage.page(1, "ACTIVE")
        assertEquals(before + 21, first.total)
        assertEquals(20, first.items.size)
        assertTrue(second.items.isNotEmpty())
        assertTrue(first.items.map { it.id }.intersect(second.items.map { it.id }.toSet()).isEmpty())
        val rejected = draft(actor)
        insertAttempt(rejected.id, version, "DECLINED", "DECLINED", true)
        val fake = FakeBank()
        service(version, fake, enabled = false).poll()
        assertTrue(storage.find(rejected.id)!!.archived)
        assertTrue(storage.page(0, "ARCHIVED").items.any { it.id == rejected.id })
        assertEquals(0, fake.declines)
    }

    @Test fun `confirmed cancellation cannot overwrite a concurrently confirmed payment`() {
        val actor = admin().id
        val version = credentialVersion(actor)
        val payment = draft(actor)
        insertAttempt(payment.id, version)
        val bank = FakeBank()
        bank.duringDecline = {
            jdbc.sql("UPDATE alfa_test_attempts SET operation_state='PAID',bank_status='PAID',archived=true WHERE payment_id=:id")
                .param("id", payment.id).update()
        }
        val result = service(version, bank).cancel(actor, payment.id, payment.version)
        assertEquals("PAID", result.operationState)
        assertTrue(result.archived)
        assertEquals(1, bank.declines)
    }

    @Test fun `concurrent issuance and lost response never register a second order`() {
        val actor = admin().id
        val version = credentialVersion(actor)
        val draft = draft(actor)
        val bank = FakeBank()
        val service = service(version, bank)
        val first = CompletableFuture.supplyAsync { service.issue(actor, draft.id, draft.version) }
        val second = CompletableFuture.supplyAsync { service.issue(actor, draft.id, draft.version) }
        CompletableFuture.allOf(first, second).join()
        assertEquals(1, bank.registrations.get())
        assertEquals("OPEN", storage.find(draft.id)!!.operationState)
        payments.save(actor, draft.id, PaymentInput(50000, "Новое назначение", "Родитель", "+79001234567", expectedVersion = draft.version))
        val changed = storage.find(draft.id)!!
        assertEquals(50000L, changed.amountMinor)
        assertEquals(12345L, changed.snapshotAmountMinor)
        assertEquals("Тест", changed.snapshotPurpose)

        val lost = draft(actor)
        bank.registrationFails = true
        assertEquals("UNKNOWN", service.issue(actor, lost.id, lost.version).operationState)
        assertEquals("UNKNOWN", service.issue(actor, lost.id, lost.version).operationState)
        assertEquals(2, bank.registrations.get())
    }

    @Test fun `new payment actions require edit while viewing does not grant mutation`() {
        val id = UUID.randomUUID()
        for (action in listOf("issue", "refresh", "cancel", "archive", "link")) {
            val required = StaffPermissionPolicy.required("POST", "/api/v1/admin/payment-requests/$id/$action")
            assertEquals("PAYMENT_EDIT", required)
            assertFalse(StaffPermissionPolicy.includes(setOf("PAYMENT_VIEW"), required!!))
            assertTrue(StaffPermissionPolicy.includes(setOf("PAYMENT_EDIT"), required))
        }
    }

    @Test fun `registration response stores link after status reconciliation without overwriting status`() {
        val actor = admin().id
        val version = credentialVersion(actor)
        val payment = draft(actor)
        val bank = FakeBank()
        bank.duringRegister = { number ->
            jdbc.sql("UPDATE alfa_test_attempts SET operation_state='OPEN',bank_status='REGISTERED',order_id='bank-id' WHERE order_number=:number")
                .param("number", number).update()
        }
        val response = service(version, bank).issue(actor, payment.id, payment.version)
        assertEquals("OPEN", response.operationState)
        assertEquals("REGISTERED", response.bankStatus)
        assertTrue(response.linkAvailable)
    }

    @Test fun `only the verified origin and exact return path reach the bank`() {
        val actor = admin().id
        val version = credentialVersion(actor)
        val bank = FakeBank()
        val payment = draft(actor)
        for (invalid in listOf("https://evil.test/lastochka/payments/test/return", "https://test.example/elsewhere",
                               "https://test.example/lastochka/payments/test/return?token=x", "http://test.example/lastochka/payments/test/return")) {
            assertThrows(org.springframework.web.server.ResponseStatusException::class.java) {
                service(version, bank, returnUrl = invalid).issue(actor, payment.id, payment.version)
            }
        }
        assertEquals(0, bank.registrations.get())
        assertNull(storage.find(payment.id)!!.operationState)
        service(version, bank).issue(actor, payment.id, payment.version)
        assertEquals(listOf("https://test.example/lastochka/payments/test/return"), bank.returnUrls)
    }

    @Test fun `scheduler does not accept a bank request after disable holds the shared lock`() {
        val actor = admin().id
        val version = credentialVersion(actor)
        val payment = draft(actor)
        insertAttempt(payment.id, version)
        val enabled = AtomicBoolean(true)
        val checked = CountDownLatch(1)
        val held = CountDownLatch(1)
        val release = CountDownLatch(1)
        val config = mock(AlfaConfigurationService::class.java)
        `when`(config.activeVersion()).thenAnswer { checked.countDown(); if (enabled.get()) version else null }
        val bank = FakeBank()
        val service = AlfaTestPaymentService(attempts, storage, config, bank, commands, access, Clock.systemUTC(), transactions, "https://test.example/lastochka/payments/test/return", "https://test.example", true, selectedTest())
        val disable = CompletableFuture.runAsync {
            TransactionTemplate(transactions).execute {
                commands.lockStudio()
                held.countDown()
                assertTrue(release.await(10, TimeUnit.SECONDS))
            }
        }
        assertTrue(held.await(10, TimeUnit.SECONDS))
        val poll = CompletableFuture.runAsync { service.poll() }
        assertTrue(checked.await(10, TimeUnit.SECONDS))
        enabled.set(false)
        release.countDown()
        CompletableFuture.allOf(disable, poll).join()
        assertEquals(0, bank.statusCalls.get())
    }

    @Test fun `archived rejection stops polling until valid signed callback requests reconciliation`() {
        val actor = admin().id
        val version = credentialVersion(actor)
        val active = draft(actor)
        val archived = draft(actor)
        insertAttempt(active.id, version, "DECLINED", "DECLINED")
        insertAttempt(archived.id, version, "DECLINED", "DECLINED")
        // Make this specific attempt due even if the database clock leads the test JVM
        // or earlier test fixtures occupy the bounded polling queue.
        jdbc.sql("UPDATE alfa_test_attempts SET next_check_at=now()-interval '1 day' WHERE payment_id=:id").param("id", active.id).update()
        jdbc.sql("UPDATE alfa_test_attempts SET archived=true WHERE payment_id=:id").param("id", archived.id).update()
        val bank = FakeBank()
        val service = service(version, bank)
        repeat(3) { service.poll() }
        assertTrue(active.id.toString() in bank.statusOrders)
        assertFalse(archived.id.toString() in bank.statusOrders)

        val key = ByteArray(32) { 7 }
        val keyFile = directory.resolve("callback.key")
        Files.writeString(keyFile, Base64.getEncoder().encodeToString(key))
        val config = mock(AlfaConfigurationService::class.java)
        `when`(config.activeVersion()).thenReturn(version)
        val callback = AlfaCallbackService(attempts, config, Clock.systemUTC(), true, keyFile.toString())
        val params = mapOf("orderNumber" to archived.id.toString(), "mdOrder" to archived.id.toString(),
            "operation" to "deposited", "status" to "1")
        val checksum = HexFormat.of().formatHex(AlfaCallbackService.checksum(params, key))
        val signed = (params + ("checksum" to checksum)).mapValues { listOf(it.value) }
        assertEquals(true, TransactionTemplate(transactions).execute { callback.accept(signed) })
        repeat(3) { service.poll() }
        assertTrue(archived.id.toString() in bank.statusOrders)
        assertTrue(storage.find(archived.id)!!.archived)
    }

    @Test fun `exported OpenAPI describes callback credential boundary pagination and CSRF`() {
        val request = HttpRequest.newBuilder(URI("http://localhost:$port/lastochka/v3/api-docs")).GET().build()
        val response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString())
        assertEquals(200, response.statusCode())
        val doc = json.readTree(response.body())
        val paths = doc.path("paths")
        val callback = paths.path("/api/v1/public/alfa-test/callback").path("get")
        val params = callback.path("parameters").associateBy { it.path("name").asString() }
        assertEquals(setOf("checksum", "orderNumber", "mdOrder", "operation", "status"), params.keys)
        assertTrue(params.values.all { it.path("in").asString() == "query" && it.path("required").asBoolean() })
        assertTrue(callback.path("description").asString().contains("HMAC-SHA256"))
        assertTrue(callback.path("security").isMissingNode || callback.path("security").isEmpty)
        assertTrue(callback.path("responses").path("404").path("content").isMissingNode)

        val schemas = doc.path("components").path("schemas")
        assertFalse(schemas.has("MultiValueMapStringString"))
        val candidate = schemas.path("AlfaCandidateRequest")
        assertEquals(setOf("login", "password", "testConfirmed"), candidate.path("required").toList().map { it.asString() }.toSet())
        for (field in listOf("login", "password", "merchantLogin"))
            assertTrue(candidate.path("properties").path(field).path("writeOnly").asBoolean(), field)
        assertTrue(schemas.path("AlfaKeyRotationRequest").path("required").any { it.asString() == "keyId" })
        val listing = paths.path("/api/v1/admin/payment-requests").path("get")
        val category = listing.path("parameters").first { it.path("name").asString() == "category" }
        assertEquals(setOf("ACTIVE", "ARCHIVED"), category.path("schema").path("enum").toList().map { it.asString() }.toSet())
        assertTrue(listing.path("description").asString().contains("20"))
        assertTrue(listing.path("security").first().has("session"))
        assertFalse(listing.path("security").first().has("csrf"))
        for (operation in listOf("issue", "cancel", "refresh", "archive", "link")) {
            val post = paths.path("/api/v1/admin/payment-requests/{id}/$operation").path("post")
            assertTrue(post.path("security").first().has("session"), operation)
            assertTrue(post.path("security").first().has("csrf"), operation)
            if (operation != "link") assertTrue(post.path("requestBody").path("required").asBoolean(), operation)
        }
        val candidatePost = paths.path("/api/v1/admin/alfa-config/candidate").path("post")
        assertTrue(candidatePost.path("security").first().has("session"))
        assertTrue(candidatePost.path("security").first().has("csrf"))
    }
}
