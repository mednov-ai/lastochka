package ru.lastochka.enquiries.dto

import com.fasterxml.jackson.annotation.JsonInclude
import io.swagger.v3.oas.annotations.media.Schema
import jakarta.validation.Valid
import jakarta.validation.constraints.*
import java.time.Instant
import java.util.UUID
import ru.lastochka.common.Metadata
import ru.lastochka.scheduling.dto.WeeklyReference
import ru.lastochka.scheduling.dto.ScheduleRuleReference

enum class EnquiryParticipantType { CHILD, SELF }

data class EnquiryInput(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    @field:Size(min = 1, max = Metadata.Concept.MAX_NAME)
    val parentName: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val phone: String,
    @field:Schema(nullable = true)
    @field:Size(min = 1, max = Metadata.Concept.MAX_NAME)
    val childName: String? = null,
    @field:Schema(nullable = true)
    @field:Min(0)
    @field:Max(Metadata.Concept.MAX_AGE_LONG)
    val childAge: Int? = null,
    @field:Schema(hidden = true) val desiredSessionId: UUID? = null,
    @field:Schema(hidden = true) val desiredSessionVersion: Long? = null,
    @field:Schema(nullable = true)
    @field:Size(max = Metadata.Concept.MAX_COMMENT)
    val comment: String? = null,
    @field:Schema(nullable = true, description = "Версия 2 включает сведения об участнике")
    val contractVersion: Int? = null,
    @field:Schema(nullable = true) val participantType: EnquiryParticipantType? = null,
    @field:Schema(nullable = true, minimum = "0", maximum = "120")
    val participantAge: Int? = null,
    @field:Valid
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:Schema(hidden = true)
    val calculatedSession: ScheduleRuleReference? = null,
    // NON_NULL keeps the replay hash of earlier contracts unchanged.
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:Schema(nullable = true, description = "Версия 3: обязательная возрастная категория")
    val ageDirectionId: UUID? = null,
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:Schema(nullable = true, description = "Версия 3: имя занимающегося")
    @field:Size(min = 1, max = Metadata.Concept.MAX_NAME)
    val participantName: String? = null,
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    val weeklyPreference: WeeklyReference? = null,
)

/** Snapshot of the age direction at submission time; later dictionary edits do not change it. */
data class EnquiryAgeDirection(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val id: UUID,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val title: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val ageFrom: Int,
    @field:Schema(nullable = true) val ageTo: Int?,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val ageOpenEnded: Boolean,
)

data class EnquiryReceipt(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val number: Long,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val createdAt: Instant,
)

data class EnquiryView(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val id: UUID,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val number: Long,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    @field:Size(min = 1, max = Metadata.Concept.MAX_NAME)
    val parentName: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val phone: String,
    @field:Schema(nullable = true)
    @field:Size(min = 1, max = Metadata.Concept.MAX_NAME)
    val childName: String?,
    @field:Schema(nullable = true)
    @field:Min(0)
    @field:Max(Metadata.Concept.MAX_AGE_LONG)
    val childAge: Int?,
    @field:Schema(nullable = true) val desiredSessionSnapshot: String?,
    @field:Schema(nullable = true) val comment: String?,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val createdAt: Instant,
    @field:Schema(nullable = true) val participantType: EnquiryParticipantType? = null,
    @field:Schema(nullable = true) val participantAge: Int? = null,
    @field:Schema(nullable = true) val ageDirection: EnquiryAgeDirection? = null,
    @field:Schema(nullable = true) val participantName: String? = null,
)

data class EnquiryPage(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val items: List<EnquiryView>,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val total: Long,
)
