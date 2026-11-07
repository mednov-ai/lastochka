package ru.lastochka.payments.alfa

import com.sun.net.httpserver.HttpsConfigurator
import com.sun.net.httpserver.HttpsServer
import java.net.InetSocketAddress
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.nio.file.Path
import java.security.KeyStore
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir

class AlfaTlsContextTest {
    @TempDir lateinit var tmp: Path
    private val pass = "fixture-password"

    private fun keytool(vararg arguments: String) {
        val executable = Path.of(System.getProperty("java.home"), "bin", "keytool").toString()
        val process = ProcessBuilder(listOf(executable) + arguments.toList())
            .redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD).start()
        assertEquals(0, process.waitFor(), "synthetic TLS fixture generation failed")
    }

    private fun makeCa(name: String, expired: Boolean = false): Pair<Path, Path> {
        val store = tmp.resolve("$name.p12"); val cert = tmp.resolve("$name.pem")
        val args = mutableListOf("-genkeypair", "-alias", name, "-keystore", store.toString(), "-storetype", "PKCS12", "-storepass", pass,
            "-keypass", pass, "-keyalg", "RSA", "-keysize", "2048", "-dname", "CN=$name", "-ext", "bc:c", "-validity", if (expired) "1" else "30", "-noprompt")
        if (expired) args.addAll(listOf("-startdate", "2020/01/01 00:00:00"))
        keytool(*args.toTypedArray())
        keytool("-exportcert", "-alias", name, "-keystore", store.toString(), "-storepass", pass, "-rfc", "-file", cert.toString())
        return store to cert
    }

    @Test
    fun `dedicated trust accepts trusted CA and rejects other CA expired certificate and hostname mismatch`() {
        val (caStore, caCert) = makeCa("root")
        val (_, otherCert) = makeCa("other")
        val (_, expiredCert) = makeCa("expired", true)
        val serverStore = tmp.resolve("server.p12"); val csr = tmp.resolve("server.csr"); val signed = tmp.resolve("server.pem")
        keytool("-genkeypair", "-alias", "server", "-keystore", serverStore.toString(), "-storetype", "PKCS12", "-storepass", pass,
            "-keypass", pass, "-keyalg", "RSA", "-keysize", "2048", "-dname", "CN=localhost", "-validity", "30", "-noprompt")
        keytool("-certreq", "-alias", "server", "-keystore", serverStore.toString(), "-storepass", pass, "-file", csr.toString())
        keytool("-gencert", "-alias", "root", "-keystore", caStore.toString(), "-storepass", pass, "-infile", csr.toString(),
            "-outfile", signed.toString(), "-rfc", "-validity", "30", "-ext", "SAN=dns:localhost", "-ext", "EKU=serverAuth")
        keytool("-importcert", "-alias", "root", "-keystore", serverStore.toString(), "-storepass", pass, "-file", caCert.toString(), "-noprompt")
        keytool("-importcert", "-alias", "server", "-keystore", serverStore.toString(), "-storepass", pass, "-file", signed.toString(), "-noprompt")

        val ks = KeyStore.getInstance("PKCS12").apply { Files.newInputStream(serverStore).use { load(it, pass.toCharArray()) } }
        val km = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply { init(ks, pass.toCharArray()) }
        val serverContext = SSLContext.getInstance("TLS").apply { init(km.keyManagers, null, null) }
        val server = HttpsServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.httpsConfigurator = HttpsConfigurator(serverContext)
        server.createContext("/") { it.sendResponseHeaders(200, 0); it.responseBody.close() }
        server.start()
        try {
            val systemDefault = SSLContext.getDefault()
            fun get(client: HttpClient, host: String): Int = client.send(
                HttpRequest.newBuilder(URI("https://$host:${server.address.port}/")).GET().build(),
                HttpResponse.BodyHandlers.discarding(),
            ).statusCode()
            val trusted = HttpClient.newBuilder().sslContext(alfaSslContext(caCert.toString())).build()
            assertEquals(200, get(trusted, "localhost"))
            assertThrows(Exception::class.java) { get(trusted, "127.0.0.1") }
            val untrusted = HttpClient.newBuilder().sslContext(alfaSslContext(otherCert.toString())).build()
            assertThrows(Exception::class.java) { get(untrusted, "localhost") }
            assertThrows(Exception::class.java) { alfaSslContext(expiredCert.toString()) }
            assertSame(systemDefault, SSLContext.getDefault())
            assertThrows(Exception::class.java) { get(HttpClient.newHttpClient(), "localhost") }
        } finally { server.stop(0) }
    }
}
