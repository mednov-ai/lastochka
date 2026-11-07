package ru.lastochka.payments.alfa

import java.nio.file.Files
import java.nio.file.Path
import java.util.Base64
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir

class AlfaSecretBoxTest {
    @TempDir lateinit var directory: Path

    @Test
    fun `ciphertext has random nonce and binds key and purpose`() {
        Files.writeString(directory.resolve("one.key"), Base64.getEncoder().encodeToString(ByteArray(32) { it.toByte() }))
        Files.writeString(directory.resolve("two.key"), Base64.getEncoder().encodeToString(ByteArray(32) { (it + 1).toByte() }))
        val first = AlfaSecretBox(directory.toString(), "one")
        val rotated = AlfaSecretBox(directory.toString(), "two")
        val plaintext = "not-a-real-secret".toByteArray()
        val encrypted = first.seal(plaintext, "credentials")
        val again = first.seal(plaintext, "credentials")
        assertFalse(encrypted.contentEquals(again))
        assertFalse(encrypted.toString(Charsets.UTF_8).contains("not-a-real-secret"))
        assertArrayEquals(plaintext, first.open(encrypted, "credentials"))
        assertArrayEquals(plaintext, rotated.open(encrypted, "credentials"))
        assertThrows(Exception::class.java) { first.open(encrypted, "link") }
        encrypted[encrypted.lastIndex] = (encrypted.last().toInt() xor 1).toByte()
        assertThrows(Exception::class.java) { first.open(encrypted, "credentials") }
        Files.delete(directory.resolve("one.key"))
        assertThrows(Exception::class.java) { rotated.open(again, "credentials") }
    }

    @Test
    fun `missing and malformed keys fail closed`() {
        assertFalse(AlfaSecretBox(directory.toString(), "missing").available())
        Files.writeString(directory.resolve("bad.key"), "not base64")
        assertFalse(AlfaSecretBox(directory.toString(), "bad").available())
        assertFalse(AlfaSecretBox(directory.toString(), "../bad").available())
    }
}
