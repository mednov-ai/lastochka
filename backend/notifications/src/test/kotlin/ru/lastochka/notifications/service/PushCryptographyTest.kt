package ru.lastochka.notifications.service

import java.security.KeyPairGenerator
import java.security.Security
import java.util.Base64
import nl.martijndwars.webpush.Encoding
import nl.martijndwars.webpush.Notification
import nl.martijndwars.webpush.PushService
import nl.martijndwars.webpush.Utils
import org.bouncycastle.jce.ECNamedCurveTable
import org.bouncycastle.jce.interfaces.ECPrivateKey
import org.bouncycastle.jce.interfaces.ECPublicKey
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import ru.lastochka.notifications.config.PushProperties
import tools.jackson.databind.json.JsonMapper

class PushCryptographyTest {
    @Test
    fun `valid VAPID keys produce encrypted push and invalid keys are unavailable`() {
        if (Security.getProvider("BC") == null) Security.addProvider(BouncyCastleProvider())
        val generator = KeyPairGenerator.getInstance("ECDH", "BC")
        generator.initialize(ECNamedCurveTable.getParameterSpec("prime256v1"))
        val vapid = generator.generateKeyPair()
        val browser = generator.generateKeyPair()
        val encode = Base64.getUrlEncoder().withoutPadding()
        val publicKey = encode.encodeToString(Utils.encode(vapid.public as ECPublicKey))
        val privateKey = encode.encodeToString(Utils.encode(vapid.private as ECPrivateKey))
        val browserKey = encode.encodeToString(Utils.encode(browser.public as ECPublicKey))
        val browserAuth = encode.encodeToString(ByteArray(16) { it.toByte() })
        val sender =
            PushSender(
                PushProperties(publicKey, privateKey, "https://example.org"),
                SafePushEndpoint(),
                JsonMapper.builder().build(),
            )
        assertTrue(sender.configured())
        assertFalse(
            PushSender(
                    PushProperties(publicKey, "invalid", ""),
                    SafePushEndpoint(),
                    JsonMapper.builder().build(),
                )
                .configured()
        )
        val payload = "{\"number\":123}".toByteArray()
        val request =
            PushService(publicKey, privateKey, "https://example.org")
                .preparePost(
                    Notification(
                        "https://fcm.googleapis.com/fcm/send/test",
                        browserKey,
                        browserAuth,
                        payload,
                        60,
                    ),
                    Encoding.AES128GCM,
                )
        assertTrue(request.getFirstHeader("Authorization").value.startsWith("vapid "))
        assertEquals("aes128gcm", request.getFirstHeader("Content-Encoding").value)
        val encrypted = request.entity.content.readBytes()
        assertFalse(encrypted.toString(Charsets.UTF_8).contains("number"))
        assertNotEquals(payload.toList(), encrypted.toList())
    }

    @Test
    fun `DNS rebinding is rejected by the resolver used for the actual connection`() {
        if (Security.getProvider("BC") == null) Security.addProvider(BouncyCastleProvider())
        val generator = KeyPairGenerator.getInstance("ECDH", "BC")
        generator.initialize(ECNamedCurveTable.getParameterSpec("prime256v1"))
        val vapid = generator.generateKeyPair()
        val browser = generator.generateKeyPair()
        val encode = Base64.getUrlEncoder().withoutPadding()
        val publicKey = encode.encodeToString(Utils.encode(vapid.public as ECPublicKey))
        val privateKey = encode.encodeToString(Utils.encode(vapid.private as ECPrivateKey))
        val browserKey = encode.encodeToString(Utils.encode(browser.public as ECPublicKey))
        val auth = encode.encodeToString(ByteArray(16))
        val safe = org.mockito.Mockito.mock(SafePushEndpoint::class.java)
        org.mockito.Mockito.`when`(safe.validate(org.mockito.ArgumentMatchers.anyString()))
            .thenAnswer { java.net.URI(it.getArgument<String>(0)) }
        org.mockito.Mockito.`when`(safe.resolve("localhost"))
            .thenThrow(IllegalStateException("rebinding rejected"))
        java.net.ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress()).use { listener ->
            listener.soTimeout = 500
            val sender =
                PushSender(
                    PushProperties(publicKey, privateKey, "https://example.org"),
                    safe,
                    JsonMapper.builder().build(),
                )
            val item =
                ru.lastochka.notifications.dto.PushDelivery(
                    java.util.UUID.randomUUID(),
                    java.util.UUID.randomUUID(),
                    java.util.UUID.randomUUID(),
                    0,
                    "https://localhost:${listener.localPort}/push",
                    browserKey,
                    auth,
                    1,
                    1,
                )
            assertThrows(Exception::class.java) { sender.send(item) }
            org.mockito.Mockito.verify(safe).resolve("localhost")
            assertThrows(java.net.SocketTimeoutException::class.java) { listener.accept().close() }
        }
    }

    @Test
    fun `push HTTP client does not follow a redirect`() {
        if (Security.getProvider("BC") == null) Security.addProvider(BouncyCastleProvider())
        val generator = KeyPairGenerator.getInstance("ECDH", "BC")
        generator.initialize(ECNamedCurveTable.getParameterSpec("prime256v1"))
        val vapid = generator.generateKeyPair()
        val browser = generator.generateKeyPair()
        val encode = Base64.getUrlEncoder().withoutPadding()
        val publicKey = encode.encodeToString(Utils.encode(vapid.public as ECPublicKey))
        val privateKey = encode.encodeToString(Utils.encode(vapid.private as ECPrivateKey))
        val browserKey = encode.encodeToString(Utils.encode(browser.public as ECPublicKey))
        val auth = encode.encodeToString(ByteArray(16))
        val tmp = java.nio.file.Files.createTempDirectory("push-redirect-test")
        val store = tmp.resolve("fixture.p12")
        val password = "fixture-only".toCharArray()
        var server: com.sun.net.httpserver.HttpsServer? = null
        try {
            val keytool =
                java.nio.file.Path.of(System.getProperty("java.home"), "bin", "keytool").toString()
            val result =
                ProcessBuilder(
                        keytool,
                        "-genkeypair",
                        "-alias",
                        "test",
                        "-keyalg",
                        "RSA",
                        "-keystore",
                        store.toString(),
                        "-storetype",
                        "PKCS12",
                        "-storepass",
                        String(password),
                        "-keypass",
                        String(password),
                        "-dname",
                        "CN=localhost",
                        "-ext",
                        "SAN=dns:localhost",
                        "-validity",
                        "1",
                        "-noprompt",
                    )
                    .redirectErrorStream(true)
                    .start()
            result.inputStream.readAllBytes()
            assertEquals(0, result.waitFor())
            val keystore = java.security.KeyStore.getInstance("PKCS12")
            java.nio.file.Files.newInputStream(store).use { keystore.load(it, password) }
            val keys =
                javax.net.ssl.KeyManagerFactory.getInstance(
                    javax.net.ssl.KeyManagerFactory.getDefaultAlgorithm()
                )
            keys.init(keystore, password)
            val trusts =
                javax.net.ssl.TrustManagerFactory.getInstance(
                    javax.net.ssl.TrustManagerFactory.getDefaultAlgorithm()
                )
            trusts.init(keystore)
            val ssl = javax.net.ssl.SSLContext.getInstance("TLS")
            ssl.init(keys.keyManagers, trusts.trustManagers, null)
            server =
                com.sun.net.httpserver.HttpsServer.create(
                    java.net.InetSocketAddress("localhost", 0),
                    0,
                )
            server.httpsConfigurator = com.sun.net.httpserver.HttpsConfigurator(ssl)
            val redirects = java.util.concurrent.atomic.AtomicInteger()
            val follows = java.util.concurrent.atomic.AtomicInteger()
            server.createContext("/push") { exchange ->
                redirects.incrementAndGet()
                exchange.responseHeaders.add("Location", "/follow")
                exchange.sendResponseHeaders(302, -1)
                exchange.close()
            }
            server.createContext("/follow") { exchange ->
                follows.incrementAndGet()
                exchange.sendResponseHeaders(200, -1)
                exchange.close()
            }
            server.start()
            val safe = org.mockito.Mockito.mock(SafePushEndpoint::class.java)
            org.mockito.Mockito.`when`(safe.validate(org.mockito.ArgumentMatchers.anyString()))
                .thenAnswer { java.net.URI(it.getArgument<String>(0)) }
            org.mockito.Mockito.`when`(safe.resolve("localhost"))
                .thenReturn(arrayOf(java.net.InetAddress.getByName("127.0.0.1")))
            val sender =
                PushSender(
                    PushProperties(publicKey, privateKey, "https://example.org"),
                    safe,
                    JsonMapper.builder().build(),
                )
            val item =
                ru.lastochka.notifications.dto.PushDelivery(
                    java.util.UUID.randomUUID(),
                    java.util.UUID.randomUUID(),
                    java.util.UUID.randomUUID(),
                    0,
                    "https://localhost:${server.address.port}/push",
                    browserKey,
                    auth,
                    1,
                    1,
                )
            assertEquals(302, sender.send(item, ssl).first)
            assertEquals(1, redirects.get())
            assertEquals(0, follows.get())
        } finally {
            server?.stop(0)
            java.nio.file.Files.deleteIfExists(store)
            java.nio.file.Files.deleteIfExists(tmp)
        }
    }
}
