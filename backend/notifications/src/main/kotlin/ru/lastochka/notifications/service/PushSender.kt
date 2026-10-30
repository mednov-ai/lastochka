package ru.lastochka.notifications.service

import java.security.Security
import nl.martijndwars.webpush.Encoding
import nl.martijndwars.webpush.Notification
import nl.martijndwars.webpush.PushService
import nl.martijndwars.webpush.Utils
import org.apache.http.client.config.RequestConfig
import org.apache.http.conn.DnsResolver
import org.apache.http.impl.client.HttpClients
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.springframework.stereotype.Service
import ru.lastochka.common.Metadata
import ru.lastochka.notifications.config.PushProperties
import ru.lastochka.notifications.dto.PushDelivery
import tools.jackson.databind.json.JsonMapper

@Service
class PushSender(
    private val properties: PushProperties,
    private val safe: SafePushEndpoint,
    private val json: JsonMapper,
) {
    init {
        if (Security.getProvider("BC") == null) Security.addProvider(BouncyCastleProvider())
    }

    private val available =
        properties.configured() &&
            runCatching {
                    val client = PushService(properties.publicKey, properties.privateKey)
                    Utils.verifyKeyPair(client.privateKey, client.publicKey)
                }
                .getOrDefault(false)

    fun configured(): Boolean = available

    fun send(item: PushDelivery): Pair<Int, Long?> = send(item, null)

    internal fun send(item: PushDelivery, tls: javax.net.ssl.SSLContext?): Pair<Int, Long?> {
        safe.validate(item.endpoint)
        val payload = json.writeValueAsBytes(mapOf("number" to item.number))
        val notification =
            Notification(
                item.endpoint,
                item.p256dh,
                item.auth,
                payload,
                Metadata.BrowserPush.PUSH_TTL_SECONDS,
            )
        val service =
            PushService(
                properties.publicKey,
                properties.privateKey,
                properties.subject.takeIf { it.isNotBlank() },
            )
        val request = service.preparePost(notification, Encoding.AES128GCM)
        safe.validate(request.uri.toString())
        val config =
            RequestConfig.custom()
                .setConnectTimeout(Metadata.BrowserPush.REQUEST_TIMEOUT_MILLIS)
                .setConnectionRequestTimeout(Metadata.BrowserPush.REQUEST_TIMEOUT_MILLIS)
                .setSocketTimeout(Metadata.BrowserPush.REQUEST_TIMEOUT_MILLIS)
                .build()
        val resolver = DnsResolver { host: String -> safe.resolve(host) }
        val clientBuilder = HttpClients.custom()
        if (tls != null) clientBuilder.setSSLContext(tls)
        clientBuilder
            .setDnsResolver(resolver)
            .setDefaultRequestConfig(config)
            .disableRedirectHandling()
            .disableAutomaticRetries()
            .build()
            .use { client ->
                client.execute(request).use { response ->
                    return response.statusLine.statusCode to
                        response
                            .getFirstHeader(Metadata.Protocol.RETRY_AFTER)
                            ?.value
                            ?.toLongOrNull()
                            ?.takeIf {
                                it > 0
                            }
                }
            }
    }
}
