package ru.lastochka.payments.alfa

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

/** Backwards-compatible TEST ciphertext format; keys are outside the database. */
@Component
class AlfaSecretBox(
    @Value(Metadata.AlfaConnection.KEY_DIRECTORY) keyDirectory: String,
    @Value(Metadata.AlfaConnection.KEY_ID) currentKeyId: String,
) : AlfaEnvironmentSecretBox(keyDirectory, currentKeyId, Metadata.AlfaConnection.TEST_ENVIRONMENT)

/** Production uses its own configured key directory, key identifier and authenticated context. */
@Component
class AlfaProductionSecretBox(
    @Value(Metadata.AlfaConnection.PRODUCTION_KEY_DIRECTORY) keyDirectory: String,
    @Value(Metadata.AlfaConnection.PRODUCTION_KEY_ID) currentKeyId: String,
) : AlfaEnvironmentSecretBox(keyDirectory, currentKeyId, Metadata.AlfaConnection.PRODUCTION_ENVIRONMENT)

open class AlfaEnvironmentSecretBox(
    private val keyDirectory: String,
    private val currentKeyId: String,
    private val environment: String,
) {
    init { require(environment in setOf(Metadata.AlfaConnection.TEST_ENVIRONMENT, Metadata.AlfaConnection.PRODUCTION_ENVIRONMENT)) }
    private val random = SecureRandom()
    private val validKeyId = Regex(Metadata.AlfaConnection.KEY_ID_PATTERN)

    fun activeKeyId(): String = currentKeyId
    fun available(id: String = currentKeyId): Boolean = runCatching { key(id).fill(0); true }.getOrDefault(false)

    fun sharesActiveKeyWith(other: AlfaEnvironmentSecretBox): Boolean = sharesKeyWith(currentKeyId, other)

    fun sharesKeyWith(id: String, other: AlfaEnvironmentSecretBox): Boolean {
        val left = key(id)
        try {
            val right = other.key(other.currentKeyId)
            try { return java.security.MessageDigest.isEqual(left, right) }
            finally { right.fill(0) }
        } finally { left.fill(0) }
    }

    private fun key(id: String): ByteArray {
        require(validKeyId.matches(id) && keyDirectory.isNotBlank())
        val path = Path.of(keyDirectory).resolve("$id.key")
        require(Files.isRegularFile(path) && Files.size(path) in 1..Metadata.AlfaConnection.KEY_FILE_LIMIT)
        val bytes = Base64.getDecoder().decode(Files.readString(path).trim())
        require(bytes.size == Metadata.AlfaConnection.KEY_BYTES)
        return bytes
    }

    fun seal(plain: ByteArray, purpose: String): ByteArray = sealWith(plain, purpose, currentKeyId)

    fun sealWith(plain: ByteArray, purpose: String, id: String): ByteArray {
        val keyBytes = key(id)
        try {
            val nonce = ByteArray(Metadata.AlfaConnection.NONCE_BYTES).also(random::nextBytes)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(keyBytes, Metadata.AlfaConnection.AES), GCMParameterSpec(Metadata.AlfaConnection.TAG_BITS, nonce))
            cipher.updateAAD("lastochka:alfa:$environment:$purpose:$id".toByteArray(Charsets.UTF_8))
            val ciphertext = cipher.doFinal(plain)
            return ByteArrayOutputStream().use { out ->
                DataOutputStream(out).use { data ->
                    data.writeByte(1); data.writeUTF(id); data.write(nonce); data.write(ciphertext)
                }
                out.toByteArray()
            }
        } finally { keyBytes.fill(0) }
    }

    fun open(sealed: ByteArray, purpose: String): ByteArray {
        require(sealed.size in Metadata.AlfaConnection.MIN_CIPHERTEXT..Metadata.AlfaConnection.MAX_CIPHERTEXT)
        val data = DataInputStream(ByteArrayInputStream(sealed))
        require(data.readUnsignedByte() == 1)
        val id = data.readUTF()
        val nonce = ByteArray(Metadata.AlfaConnection.NONCE_BYTES).also(data::readFully)
        val ciphertext = data.readAllBytes()
        val keyBytes = key(id)
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(keyBytes, Metadata.AlfaConnection.AES), GCMParameterSpec(Metadata.AlfaConnection.TAG_BITS, nonce))
            cipher.updateAAD("lastochka:alfa:$environment:$purpose:$id".toByteArray(Charsets.UTF_8))
            return cipher.doFinal(ciphertext)
        } finally { keyBytes.fill(0) }
    }
}
