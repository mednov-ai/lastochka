package ru.lastochka.notifications.service

import java.security.MessageDigest
import java.util.UUID
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.identity.service.AccountService
import ru.lastochka.notifications.config.PushProperties
import ru.lastochka.notifications.dto.NotificationSettings
import ru.lastochka.notifications.repo.NotificationRoutesRepository

@Service
class NotificationRoutes(
    private val storage: NotificationRoutesRepository,
    private val accounts: AccountService,
    private val push: PushProperties,
    @Value(Metadata.Concept.ACCESS_GENERATION) generation: String,
) {
    val generationHash: String =
        MessageDigest.getInstance(Metadata.Protocol.SHA256)
            .digest((generation + "\u0000" + push.publicKey).toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    @Transactional(propagation = Propagation.MANDATORY)
    fun enqueue(id: UUID, settings: NotificationSettings) {
        storage.record(id, settings)
        if (settings.browserPushEnabled) {
            var count = 0
            for (target in storage.targets(generationHash)) {
                if (accounts.pushEligible(target.accountId, target.authVersion)) {
                    storage.enqueue(id, target.id)
                    count++
                } else storage.deactivate(target.id)
            }
            storage.count(id, count)
        }
    }

    fun summary(id: UUID, configured: Boolean) = storage.summary(id, configured)
}
