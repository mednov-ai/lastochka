package ru.lastochka.payments.alfa

import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.time.Duration
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import org.springframework.context.annotation.Primary
import ru.lastochka.common.Metadata
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/** The legacy injectable gateway remains TEST-only for old clients. */
@Component
@Primary
class AlfaBankHttpGateway(
    json: JsonMapper,
    @Value(Metadata.AlfaConnection.CA_FILE) caFile: String,
) : AlfaBankGateway by AlfaHttpTransport(json, caFile, AlfaGatewayEnvironment.TEST, Metadata.AlfaPayment.BANK_RUB)

/** The production transport cannot send or read credentials when the server policy forbids it. */
@Component
class AlfaProductionHttpGateway(
    json: JsonMapper,
    @Value(Metadata.AlfaConnection.PRODUCTION_CA_FILE) caFile: String,
    @Value(Metadata.AlfaConnection.PRODUCTION_CURRENCY) val currency: String,
    private val policy: AlfaProductionPolicy,
) : AlfaBankGateway {
    private val transport = AlfaHttpTransport(json, caFile, AlfaGatewayEnvironment.PRODUCTION, currency)
    override val environment = AlfaGatewayEnvironment.PRODUCTION
    private fun requireAllowed() { check(policy.productionAllowed()) { "Production bank requests forbidden" } }
    override fun register(credentials: AlfaCredentials, orderNumber: String, amountMinor: Long, returnUrl: String): AlfaRegisterResult {
        requireAllowed()
        return transport.register(credentials, orderNumber, amountMinor, returnUrl)
    }
    override fun status(credentials: AlfaCredentials, orderId: String?, orderNumber: String?): AlfaStatusResult {
        requireAllowed()
        return transport.status(credentials, orderId, orderNumber)
    }
    override fun decline(credentials: AlfaCredentials, orderId: String?, orderNumber: String?): AlfaDeclineResult {
        requireAllowed()
        return transport.decline(credentials, orderId, orderNumber)
    }
}

/** Fixed bank-owned endpoint per environment; redirects and arbitrary URLs are forbidden. */
private class AlfaHttpTransport(
    private val json: JsonMapper,
    private val caFile: String,
    override val environment: AlfaGatewayEnvironment,
    private val currency: String,
) : AlfaBankGateway {
    private val base = alfaBankEndpoint(environment)
    private val methods = setOf("register.do", "getOrderStatusExtended.do", "decline.do")

    override fun register(credentials: AlfaCredentials, orderNumber: String, amountMinor: Long, returnUrl: String): AlfaRegisterResult {
        require(amountMinor > 0 && orderNumber.isNotBlank())
        require(currency in setOf(Metadata.AlfaPayment.BANK_RUB, Metadata.AlfaPayment.ISO_RUB))
        val params = alfaRegistrationParameters(orderNumber, amountMinor, returnUrl) + ("currency" to currency)
        val node = request("register.do", credentials, params)
        return AlfaRegisterResult(node.textOrNull("orderId"), node.textOrNull("formUrl"), node.textOrNull("errorCode"))
    }

    override fun status(credentials: AlfaCredentials, orderId: String?, orderNumber: String?): AlfaStatusResult {
        val params = orderParams(orderId, orderNumber)
        val node = request("getOrderStatusExtended.do", credentials, params)
        return AlfaStatusResult(node.textOrNull("orderNumber"), node.textOrNull("orderId"),
            node.textOrNull("amount")?.toLongOrNull(), node.textOrNull("currency"),
            node.textOrNull("orderStatus")?.toIntOrNull(), node.textOrNull("errorCode"))
    }

    override fun decline(credentials: AlfaCredentials, orderId: String?, orderNumber: String?): AlfaDeclineResult {
        val merchant = credentials.merchantLogin?.takeIf { it.isNotBlank() }
            ?: throw IllegalStateException("$environment cancellation unavailable")
        val node = request("decline.do", credentials, orderParams(orderId, orderNumber) + ("merchantLogin" to merchant))
        return AlfaDeclineResult(node.textOrNull("errorCode"))
    }

    private fun orderParams(orderId: String?, orderNumber: String?): Map<String, String> = when {
        !orderId.isNullOrBlank() -> mapOf("orderId" to orderId)
        !orderNumber.isNullOrBlank() -> mapOf("orderNumber" to orderNumber)
        else -> throw IllegalArgumentException("$environment order identifier required")
    }

    private fun request(method: String, credentials: AlfaCredentials, params: Map<String, String>): JsonNode {
        try {
            require(method in methods)
            val context = alfaSslContext(caFile)
            val client = HttpClient.newBuilder().sslContext(context).connectTimeout(Duration.ofSeconds(Metadata.AlfaConnection.CONNECT_TIMEOUT_SECONDS))
                .followRedirects(HttpClient.Redirect.NEVER).build()
            val values = params + mapOf("userName" to credentials.login, Metadata.Fields.PASSWORD to credentials.password)
            val body = values.entries.joinToString("&") { (key, value) ->
                URLEncoder.encode(key, StandardCharsets.UTF_8) + "=" + URLEncoder.encode(value, StandardCharsets.UTF_8)
            }
            val request = HttpRequest.newBuilder(URI.create(base + method)).timeout(Duration.ofSeconds(Metadata.AlfaConnection.RESPONSE_TIMEOUT_SECONDS))
                .header(Metadata.Protocol.CONTENT_TYPE, "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build()
            val response = client.send(request, HttpResponse.BodyHandlers.ofInputStream())
            response.body().use { stream ->
                if (response.statusCode() != Metadata.AlfaConnection.HTTP_OK) throw IllegalStateException("$environment bank response unavailable")
                val bytes = stream.readNBytes(Metadata.AlfaConnection.RESPONSE_READ_LIMIT)
                require(bytes.size <= Metadata.AlfaConnection.RESPONSE_LIMIT)
                return json.readTree(bytes)
            }
        } catch (_: Exception) {
            // Outcome may be ambiguous after transmission: caller must reconcile, never retry registration blindly.
            throw IllegalStateException("$environment bank request failed")
        }
    }

    private fun JsonNode.textOrNull(name: String): String? = get(name)?.takeUnless { it.isNull }?.asText()
}

internal fun alfaRegistrationParameters(orderNumber: String, amountMinor: Long, returnUrl: String): Map<String, String> =
    mapOf("orderNumber" to orderNumber, "amount" to amountMinor.toString(),
        "currency" to Metadata.AlfaPayment.BANK_RUB, "returnUrl" to returnUrl)

internal fun alfaBankEndpoint(environment: AlfaGatewayEnvironment): String = when (environment) {
    AlfaGatewayEnvironment.TEST -> "https://alfa.rbsuat.com/payment/rest/"
    AlfaGatewayEnvironment.PRODUCTION -> "https://payment.alfabank.ru/payment/rest/"
    AlfaGatewayEnvironment.UNKNOWN -> throw IllegalArgumentException("Unknown bank environment")
}

/** Dedicated trust material; default JVM trust and hostname checks are not modified. */
internal fun alfaSslContext(caFile: String): SSLContext {
    require(caFile.isNotBlank())
    val path = Path.of(caFile)
    require(Files.isRegularFile(path) && Files.size(path) in 1..Metadata.AlfaConnection.CERT_FILE_LIMIT)
    val certs = Files.newInputStream(path).use { CertificateFactory.getInstance("X.509").generateCertificates(it) }
    require(certs.isNotEmpty())
    val store = KeyStore.getInstance(KeyStore.getDefaultType()).apply { load(null, null) }
    certs.forEachIndexed { index, cert ->
        require(cert is X509Certificate); cert.checkValidity()
        store.setCertificateEntry("alfa-$index", cert)
    }
    val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
    factory.init(store)
    return SSLContext.getInstance(Metadata.AlfaConnection.TLS).apply { init(null, factory.trustManagers, null) }
}
