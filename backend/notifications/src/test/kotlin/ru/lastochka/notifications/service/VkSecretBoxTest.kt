package ru.lastochka.notifications.service

import java.nio.file.Files
import java.nio.file.Path
import java.util.Base64
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir

class VkSecretBoxTest {
    @TempDir lateinit var keys: Path

    @Test
    fun `tokens are authenticated to their key and deployment and stay readable across rotation`() {
        fun write(id: String, byte: Byte) =
            Files.writeString(
                keys.resolve("$id.key"),
                Base64.getEncoder().encodeToString(ByteArray(32) { byte }),
            )
        write("first", 1)
        write("next", 2)
        val test = VkSecretBox(keys.toString(), "first", "test")
        val prod = VkSecretBox(keys.toString(), "first", "production")
        val rotated = VkSecretBox(keys.toString(), "next", "test")
        val token = "fixture-vk-token"
        val envelope = test.seal(token)
        assertFalse(envelope.contentEquals(test.seal(token)))
        assertFalse(envelope.toString(Charsets.UTF_8).contains(token))
        assertEquals(token, test.open(envelope))
        assertEquals(token, rotated.open(envelope))
        assertNotEquals(test.randomId(1), prod.randomId(1))
        assertThrows(Exception::class.java) { prod.open(envelope) }
        assertThrows(Exception::class.java) {
            test.open(
                envelope.copyOf().also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() }
            )
        }
        write("first", 9)
        assertThrows(Exception::class.java) { test.open(envelope) }
        assertFalse(VkSecretBox(keys.toString(), "absent", "test").available())
    }
}
