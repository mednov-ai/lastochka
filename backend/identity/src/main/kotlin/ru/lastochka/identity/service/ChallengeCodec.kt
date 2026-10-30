package ru.lastochka.identity.service

import java.io.*
import java.util.Base64
import org.springframework.stereotype.Component
import ru.lastochka.common.Metadata

/**
 * Server-created options use the same Serializable contract as Spring Session. The value is never
 * accepted from a browser; the DB store binds it to session/account/type.
 */
@Component
class ChallengeCodec {
    fun encode(value: Serializable): String {
        val bytes = ByteArrayOutputStream()
        ObjectOutputStream(bytes).use { it.writeObject(value) }
        return Base64.getEncoder().encodeToString(bytes.toByteArray())
    }

    fun <T : Any> decode(value: String, type: Class<T>): T {
        val bytes = Base64.getDecoder().decode(value)
        require(bytes.size <= Metadata.IdentityLimits.MAX_CHALLENGE_BYTES)
        return ObjectInputStream(ByteArrayInputStream(bytes)).use {
            it.setObjectInputFilter(
                ObjectInputFilter.Config.createFilter(
                    "maxbytes=262144;maxdepth=32;org.springframework.security.web.webauthn.**;java.lang.**;java.util.**;java.time.**;!*"
                )
            )
            type.cast(it.readObject())
        }
    }
}
