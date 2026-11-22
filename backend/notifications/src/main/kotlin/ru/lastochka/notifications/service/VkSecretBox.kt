package ru.lastochka.notifications.service

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.nio.file.Files
import java.nio.file.Path
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import ru.lastochka.common.Metadata

@Component
class VkSecretBox(
    @Value(Metadata.Vk.KEY_DIRECTORY) private val directory: String,
    @Value(Metadata.Vk.KEY_ID) private val keyId: String,
    @Value(Metadata.Vk.ENVIRONMENT) private val environment: String,
) {
    private val secureRandom = SecureRandom()

    fun available(): Boolean = runCatching { loadKey(keyId).fill(0) }.isSuccess

    fun seal(token: String): ByteArray {
        val nonce = ByteArray(Metadata.AlfaConnection.NONCE_BYTES).also(secureRandom::nextBytes)
        val bytes = token.toByteArray(Charsets.UTF_8)
        val ciphertext =
            try {
                crypt(Cipher.ENCRYPT_MODE, keyId, nonce, bytes)
            } finally {
                bytes.fill(0)
            }
        val buffer = ByteArrayOutputStream()
        DataOutputStream(buffer).use { out ->
            out.writeByte(Metadata.Vk.SECRET_FORMAT)
            out.writeUTF(keyId)
            out.write(nonce)
            out.write(ciphertext)
        }
        return buffer.toByteArray()
    }

    fun open(sealed: ByteArray): String {
        require(sealed.size in Metadata.Vk.MIN_ENVELOPE_BYTES..Metadata.Vk.MAX_ENVELOPE_BYTES)
        return DataInputStream(ByteArrayInputStream(sealed)).use { input ->
            require(input.readUnsignedByte() == Metadata.Vk.SECRET_FORMAT)
            val id = input.readUTF()
            val nonce = ByteArray(Metadata.AlfaConnection.NONCE_BYTES).also(input::readFully)
            val clear = crypt(Cipher.DECRYPT_MODE, id, nonce, input.readAllBytes())
            try {
                clear.toString(Charsets.UTF_8)
            } finally {
                clear.fill(0)
            }
        }
    }

    fun randomId(sequence: Int): Int =
        if (environment.equals(Metadata.AlfaConnection.TEST_ENVIRONMENT, ignoreCase = true))
            sequence + Metadata.Vk.TEST_RANDOM_ID_OFFSET
        else sequence

    private fun loadKey(id: String): ByteArray {
        require(
            environment.equals(Metadata.AlfaConnection.TEST_ENVIRONMENT, ignoreCase = true) ||
                environment.equals(
                    Metadata.AlfaConnection.PRODUCTION_ENVIRONMENT,
                    ignoreCase = true,
                )
        )
        require(directory.isNotBlank() && id.matches(Regex(Metadata.AlfaConnection.KEY_ID_PATTERN)))
        val path = Path.of(directory).resolve("$id.key")
        require(
            Files.isRegularFile(path) &&
                Files.size(path) in 1..Metadata.AlfaConnection.KEY_FILE_LIMIT
        )
        val bytes = Base64.getDecoder().decode(Files.readString(path).trim())
        if (bytes.size != Metadata.AlfaConnection.KEY_BYTES) {
            bytes.fill(0)
            error("Invalid VK encryption key")
        }
        return bytes
    }

    private fun crypt(mode: Int, id: String, nonce: ByteArray, bytes: ByteArray): ByteArray {
        val key = loadKey(id)
        try {
            return Cipher.getInstance("AES/GCM/NoPadding")
                .apply {
                    init(
                        mode,
                        SecretKeySpec(key, Metadata.AlfaConnection.AES),
                        GCMParameterSpec(Metadata.AlfaConnection.TAG_BITS, nonce),
                    )
                    updateAAD(
                        "lastochka:vk:${environment.lowercase(java.util.Locale.ROOT)}:community-token:$id"
                            .toByteArray(Charsets.UTF_8)
                    )
                }
                .doFinal(bytes)
        } finally {
            key.fill(0)
        }
    }
}
