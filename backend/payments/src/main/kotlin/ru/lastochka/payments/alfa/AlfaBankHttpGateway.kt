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
import ru.lastochka.common.Metadata
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/** A closed test-only endpoint; no credentials in URLs, redirects, exceptions or logs. */
@Component
class AlfaBankHttpGateway(
    private val json: JsonMapper,
    @Value(Metadata.AlfaConnection.CA_FILE) private val caFile: String,
) : AlfaBankGateway {
    private val base = "https://alfa.rbsuat.com/payment/rest/"
    private val methods = setOf("register.do", "getOrderStatusExtended.do", "decline.do")

    override fun register(credentials: AlfaCredentials, orderNumber: String, amountMinor: Long, returnUrl: String): AlfaRegisterResult {
        require(amountMinor > 0 && orderNumber.isNotBlank())
        val node = request("register.do", credentials, alfaRegistrationParameters(orderNumber, amountMinor, returnUrl))
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
            ?: throw IllegalStateException("TEST cancellation unavailable")
        val node = request("decline.do", credentials, orderParams(orderId, orderNumber) + ("merchantLogin" to merchant))
        return AlfaDeclineResult(node.textOrNull("errorCode"))
    }

    private fun orderParams(orderId: String?, orderNumber: String?): Map<String, String> = when {
        !orderId.isNullOrBlank() -> mapOf("orderId" to orderId)
        !orderNumber.isNullOrBlank() -> mapOf("orderNumber" to orderNumber)
        else -> throw IllegalArgumentException("TEST order identifier required")
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
                if (response.statusCode() != Metadata.AlfaConnection.HTTP_OK) throw IllegalStateException("TEST bank response unavailable")
                val bytes = stream.readNBytes(Metadata.AlfaConnection.RESPONSE_READ_LIMIT)
                require(bytes.size <= Metadata.AlfaConnection.RESPONSE_LIMIT)
                return json.readTree(bytes)
            }
        } catch (_: Exception) {
            // Outcome may be ambiguous after transmission: caller must reconcile, never retry registration blindly.
            throw IllegalStateException("TEST bank request failed")
        }
    }

    private fun JsonNode.textOrNull(name: String): String? = get(name)?.takeUnless { it.isNull }?.asText()
}

internal fun alfaRegistrationParameters(orderNumber: String, amountMinor: Long, returnUrl: String): Map<String, String> =
    mapOf("orderNumber" to orderNumber, "amount" to amountMinor.toString(),
        "currency" to Metadata.AlfaPayment.BANK_RUB, "returnUrl" to returnUrl)

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
