package ru.lastochka.enquiries.service

import java.security.MessageDigest
import java.time.Clock
import java.util.UUID
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.*
import ru.lastochka.common.service.CommandService
import ru.lastochka.common.service.ContactValidation
import ru.lastochka.common.service.UserMessages
import ru.lastochka.enquiries.dto.*
import ru.lastochka.enquiries.repo.EnquiryRepository
import ru.lastochka.notifications.service.NotificationRoutes
import ru.lastochka.notifications.service.NotificationSettingsService
import ru.lastochka.notifications.service.TelegramQueue
import ru.lastochka.scheduling.service.SchedulingService
import tools.jackson.databind.json.JsonMapper

@Service
class EnquiryService(
    private val storage: EnquiryRepository,
    private val scheduling: SchedulingService,
    private val commands: CommandService,
    private val telegram: TelegramQueue,
    private val notificationSettings: NotificationSettingsService,
    private val notificationRoutes: NotificationRoutes,
    private val json: JsonMapper,
    private val texts: UserMessages,
    private val clock: Clock,
) {
    @Transactional
    fun submit(key: UUID, input: EnquiryInput): EnquiryReceipt {
        val normalized =
            input.copy(
                parentName = ContactValidation.name(input.parentName, "parentName"),
                phone = ContactValidation.phone(input.phone),
                childName = input.childName?.let { ContactValidation.name(it, "childName") },
                comment = input.comment?.trim()?.takeIf { it.isNotEmpty() },
            )
        if (normalized.childAge != null && normalized.childAge !in 0..Metadata.Concept.MAX_AGE)
            throw FieldValidationException(mapOf("childAge" to Metadata.Concept.FIELD_AGE))
        if ((normalized.comment?.length ?: 0) > Metadata.Concept.MAX_COMMENT)
            throw FieldValidationException(mapOf("comment" to Metadata.ErrorCodes.FIELD_LENGTH))
        val hash =
            MessageDigest.getInstance(Metadata.Protocol.SHA256)
                .digest(json.writeValueAsBytes(normalized))
                .joinToString("") { "%02x".format(it) }
        storage.lock(key)
        storage.replay(key)?.let { (old, id) ->
            if (old != hash) conflict(Metadata.ErrorCodes.IDEMPOTENCY_CONFLICT)
            val saved = storage.find(id) ?: notFound(Metadata.ErrorCodes.NOT_FOUND)
            return EnquiryReceipt(saved.number, saved.createdAt)
        }
        // Serializes with all schedule commands; no obsolete revision can slip through commit.
        commands.lockStudio()
        val snapshot =
            normalized.desiredSessionId?.let { id ->
                val s = scheduling.find(id)
                if (
                    s.status != Metadata.Scheduling.OPEN ||
                        s.startsAt <= clock.instant() ||
                        s.version != normalized.desiredSessionVersion
                )
                    conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
                texts.render(
                    Metadata.Concept.SESSION_SNAPSHOT,
                    s.title,
                    s.startsAt
                        .atZone(java.time.ZoneId.of(Metadata.Time.STUDIO_ZONE))
                        .toLocalDateTime(),
                    s.endsAt.atZone(java.time.ZoneId.of(Metadata.Time.STUDIO_ZONE)).toLocalTime(),
                    if (s.format == Metadata.Scheduling.GROUP)
                        texts.render("session.group", s.capacity)
                    else texts.render("session.individual"),
                    if (s.ageFrom != null) texts.render("session.age", s.ageFrom, s.ageTo)
                    else texts.render("session.age-unspecified"),
                )
            }
        val saved = storage.insert(UUID.randomUUID(), normalized, snapshot)
        val routes = notificationSettings.snapshot()
        notificationRoutes.enqueue(saved.id, routes)
        if (routes.telegramEnabled)
            telegram.enqueue(
                saved.id,
                texts.render(
                    Metadata.Concept.TELEGRAM_TEXT,
                    saved.number,
                    saved.createdAt
                        .atZone(java.time.ZoneId.of(Metadata.Time.STUDIO_ZONE))
                        .toLocalDateTime(),
                    saved.parentName,
                    saved.phone,
                    saved.childName ?: texts.render("enquiry.not-specified"),
                    saved.childAge ?: texts.render("enquiry.not-specified"),
                    snapshot.orEmpty(),
                    saved.comment.orEmpty(),
                ),
            )
        storage.saveReplay(key, hash, saved.id)
        return EnquiryReceipt(saved.number, saved.createdAt)
    }

    fun page(page: Int): EnquiryPage {
        if (page < 0) badRequest(Metadata.ErrorCodes.INVALID_PAGE)
        return storage.page(page)
    }

    fun find(id: UUID): EnquiryView = storage.find(id) ?: notFound(Metadata.ErrorCodes.NOT_FOUND)
}
