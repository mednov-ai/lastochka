package ru.lastochka.enquiries.service

import java.security.MessageDigest
import java.time.DayOfWeek
import java.time.LocalTime
import java.time.format.TextStyle
import java.time.format.DateTimeFormatter
import java.util.Locale
import ru.lastochka.scheduling.service.WeeklyScheduleService
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
import ru.lastochka.scheduling.service.AgeDirectionService
import tools.jackson.databind.json.JsonMapper

@Service
class EnquiryService(
    private val storage: EnquiryRepository,
    private val weekly: WeeklyScheduleService,
    private val directions: AgeDirectionService,
    private val commands: CommandService,
    private val telegram: TelegramQueue,
    private val notificationSettings: NotificationSettingsService,
    private val notificationRoutes: NotificationRoutes,
    private val json: JsonMapper,
    private val texts: UserMessages,
) {
    @Transactional
    fun submit(key: UUID, input: EnquiryInput): EnquiryReceipt {
        val normalized =
            input.copy(
                parentName = ContactValidation.name(input.parentName, "parentName"),
                phone = ContactValidation.phone(input.phone),
                childName = input.childName?.let { ContactValidation.name(it, "childName") },
                participantName =
                    input.participantName?.trim()?.takeIf { it.isNotEmpty() }?.let {
                        ContactValidation.name(it, "participantName")
                    },
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
        if (normalized.calculatedSession != null || normalized.desiredSessionId != null || normalized.desiredSessionVersion != null)
            conflict(Metadata.ErrorCodes.DATED_SELECTION_RETIRED)
        val direction =
            normalized.ageDirectionId?.let { id ->
                val active =
                    directions.activeById(id)
                        ?: throw FieldValidationException(
                            mapOf("ageDirectionId" to Metadata.Concept.FIELD_AGE_DIRECTION)
                        )
                EnquiryAgeDirection(active.id, active.title, active.ageFrom, active.ageTo, active.ageOpenEnded)
            }
        val preference = normalized.weeklyPreference?.let { ref ->
            val interval = weekly.current().intervals.singleOrNull { it.reference == ref && it.directionId == direction?.id }
                ?: conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
            val start = java.time.LocalDate.EPOCH.atTime(LocalTime.MIDNIGHT).plusMinutes(interval.startMinute.toLong())
            val end = start.plusMinutes(interval.durationMinutes.toLong())
            val fmt = DateTimeFormatter.ofPattern("HH:mm")
            texts.render("enquiry.weekly-preference",
                DayOfWeek.of(interval.weekday).getDisplayName(TextStyle.FULL_STANDALONE, Locale.forLanguageTag("ru")),
                fmt.format(start), fmt.format(end), if (end.toLocalDate() != start.toLocalDate()) texts.render("enquiry.day-offset", end.toLocalDate().toEpochDay()) else "",
                requireNotNull(direction).title)
        }
        val saved = storage.insert(UUID.randomUUID(), normalized, preference, direction)
        val routes = notificationSettings.snapshot()
        notificationRoutes.enqueue(saved.id, routes)
        if (routes.telegramEnabled)
            telegram.enqueue(saved.id, telegramText(saved, saved.desiredSessionSnapshot))
        storage.saveReplay(key, hash, saved.id)
        return EnquiryReceipt(saved.number, saved.createdAt)
    }

    private fun telegramText(saved: EnquiryView, snapshot: String?): String {
        val createdAt = saved.createdAt.atZone(java.time.ZoneId.of(Metadata.Time.STUDIO_ZONE)).toLocalDateTime()
        val missing = texts.render("enquiry.not-specified")
        saved.ageDirection?.let { direction ->
            return texts.render(
                Metadata.Concept.TELEGRAM_DIRECTION_TEXT,
                saved.number,
                createdAt,
                saved.parentName,
                saved.phone,
                direction.title,
                saved.participantName ?: missing,
                snapshot ?: missing,
                saved.comment ?: missing,
            )
        }
        return texts.render(
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
                )
    }

    fun page(page: Int): EnquiryPage {
        if (page < 0) badRequest(Metadata.ErrorCodes.INVALID_PAGE)
        return storage.page(page)
    }

    fun find(id: UUID): EnquiryView = storage.find(id) ?: notFound(Metadata.ErrorCodes.NOT_FOUND)
}
