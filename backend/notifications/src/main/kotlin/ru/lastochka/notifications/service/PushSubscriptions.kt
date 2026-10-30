package ru.lastochka.notifications.service

import java.security.MessageDigest
import java.security.Security
import java.util.Base64
import java.util.UUID
import nl.martijndwars.webpush.Utils
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.badRequest
import ru.lastochka.common.error.conflict
import ru.lastochka.notifications.config.PushProperties
import ru.lastochka.notifications.dto.*
import ru.lastochka.notifications.repo.PushSubscriptionRepository

@Service
class PushSubscriptions(
    private val storage: PushSubscriptionRepository,
    private val endpoint: SafePushEndpoint,
    private val properties: PushProperties,
    private val routes: NotificationRoutes,
    private val sender: PushSender,
) {
    init {
        if (Security.getProvider("BC") == null) Security.addProvider(BouncyCastleProvider())
    }

    fun configuration(): PushConfigurationView =
        PushConfigurationView(
            sender.configured(),
            properties.publicKey.takeIf { sender.configured() },
        )

    @Transactional
    fun subscribe(owner: UUID, version: Long, input: PushSubscriptionInput): PushSubscriptionView {
        if (!sender.configured()) badRequest(Metadata.ErrorCodes.FIELD_INVALID)
        try {
            endpoint.validate(input.endpoint)
            val key = Base64.getUrlDecoder().decode(input.p256dh)
            val secret = Base64.getUrlDecoder().decode(input.auth)
            require(
                key.size == Metadata.BrowserPush.PUBLIC_KEY_BYTES &&
                    key.first() == Metadata.BrowserPush.PUBLIC_KEY_PREFIX.toByte() &&
                    secret.size == Metadata.BrowserPush.AUTH_SECRET_BYTES
            )
            Utils.loadPublicKey(input.p256dh)
        } catch (_: Exception) {
            badRequest(Metadata.ErrorCodes.FIELD_INVALID)
        }
        val hash =
            MessageDigest.getInstance(Metadata.Protocol.SHA256)
                .digest(input.endpoint.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
        val id =
            storage.save(UUID.randomUUID(), owner, version, routes.generationHash, hash, input)
                ?: conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
        return PushSubscriptionView(id)
    }

    @Transactional
    fun unsubscribe(owner: UUID, id: UUID) {
        storage.deactivate(id, owner)
    }

    fun status(owner: UUID, version: Long, id: UUID) =
        PushSubscriptionStatus(storage.active(id, owner, version, routes.generationHash))
}
