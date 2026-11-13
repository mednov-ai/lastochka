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
import ru.lastochka.scheduling.service.PermanentOccurrenceService
import tools.jackson.databind.json.JsonMapper

@Service
class EnquiryService(
    private val storage: EnquiryRepository,
    private val scheduling: SchedulingService,
    private val permanent: PermanentOccurrenceService,
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
        validateEnquiryParticipant(normalized)
        if ((normalized.comment?.length ?: 0) > Metadata.Concept.MAX_COMMENT)
            throw FieldValidationException(mapOf("comment" to Metadata.ErrorCodes.FIELD_LENGTH))
        val hash =
            MessageDigest.getInstance(Metadata.Protocol.SHA256)
                .digest(json.writeValueAsBytes(enquiryHashInput(normalized)))
                .joinToString("") { "%02x".format(it) }
        storage.lock(key)
        storage.replay(key)?.let { (old, id) ->
            if (old != hash) conflict(Metadata.ErrorCodes.IDEMPOTENCY_CONFLICT)
            val saved = storage.find(id) ?: notFound(Metadata.ErrorCodes.NOT_FOUND)
            return EnquiryReceipt(saved.number, saved.createdAt)
        }
        // Serializes with all schedule commands; no obsolete revision can slip through commit.
        commands.lockStudio()
        val selected = normalized.calculatedSession?.let {
            permanent.materialize(it.seriesId, it.originalDate, it.seriesVersion)
        } ?: normalized.desiredSessionId?.let { scheduling.find(it) }
        val snapshot =
            selected?.let { s ->
                if (
                    s.status != Metadata.Scheduling.OPEN ||
                        s.startsAt <= clock.instant() ||
                        (normalized.calculatedSession == null && s.version != normalized.desiredSessionVersion)
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
                    if (s.ageFrom != null && s.ageOpenEnded) texts.render("session.age-open", s.ageFrom)
                    else if (s.ageFrom != null) texts.render("session.age", s.ageFrom, s.ageTo)
                    else texts.render("session.age-unspecified"),
                )
            }
        val persisted = if (normalized.calculatedSession == null) normalized else
            normalized.copy(desiredSessionId = selected!!.id, desiredSessionVersion = selected.version, calculatedSession = null)
        val saved = storage.insert(UUID.randomUUID(), persisted, snapshot)
        val routes = notificationSettings.snapshot()
        notificationRoutes.enqueue(saved.id, routes)
        if (routes.telegramEnabled)
            telegram.enqueue(
                saved.id,
                texts.render(
                    when (saved.participantType) {
                        EnquiryParticipantType.SELF -> "enquiry.telegram-self"
                        EnquiryParticipantType.CHILD -> "enquiry.telegram-child"
                        null -> Metadata.Concept.TELEGRAM_TEXT
                    },
                    saved.number,
                    saved.createdAt
                        .atZone(java.time.ZoneId.of(Metadata.Time.STUDIO_ZONE))
                        .toLocalDateTime(),
                    saved.parentName,
                    saved.phone,
                    saved.childName ?: texts.render("enquiry.not-specified"),
                    saved.participantAge ?: saved.childAge ?: texts.render("enquiry.not-specified"),
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
