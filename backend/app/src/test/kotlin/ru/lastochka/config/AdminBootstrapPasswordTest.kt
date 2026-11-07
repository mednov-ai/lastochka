package ru.lastochka.config

import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir

class AdminBootstrapPasswordTest {
    @TempDir lateinit var directory: Path

    @Test
    fun `file source preserves exact password bytes`() {
        val file = directory.resolve("password")
        Files.writeString(file, "  Пароль123  ")
        assertEquals(
            "  Пароль123  ",
            AdminBootstrapPassword.resolve(
                mapOf("LASTOCHKA_ADMIN_PASSWORD_FILE" to file.toString())
            ),
        )
    }

    @Test
    fun `legacy source remains compatible`() {
        assertEquals(
            "legacy1",
            AdminBootstrapPassword.resolve(mapOf("LASTOCHKA_ADMIN_PASSWORD" to "legacy1")),
        )
    }

    @Test
    fun `missing conflicting and unsafe sources fail closed`() {
        val file = directory.resolve("password")
        Files.writeString(file, "secret1")
        assertThrows(IllegalArgumentException::class.java) {
            AdminBootstrapPassword.resolve(emptyMap())
        }
        assertThrows(IllegalArgumentException::class.java) {
            AdminBootstrapPassword.resolve(
                mapOf(
                    "LASTOCHKA_ADMIN_PASSWORD" to "secret1",
                    "LASTOCHKA_ADMIN_PASSWORD_FILE" to file.toString(),
                )
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            AdminBootstrapPassword.resolve(mapOf("LASTOCHKA_ADMIN_PASSWORD_FILE" to "relative"))
        }
        val link = directory.resolve("link")
        Files.createSymbolicLink(link, file)
        assertThrows(IllegalArgumentException::class.java) {
            AdminBootstrapPassword.resolve(
                mapOf("LASTOCHKA_ADMIN_PASSWORD_FILE" to link.toString())
            )
        }
    }

    @Test
    fun `oversized file is rejected`() {
        val file = directory.resolve("large")
        Files.write(file, ByteArray(1025))
        assertThrows(IllegalArgumentException::class.java) {
            AdminBootstrapPassword.resolve(
                mapOf("LASTOCHKA_ADMIN_PASSWORD_FILE" to file.toString())
            )
        }
    }
}
