package ru.lastochka.enquiries.dto

import io.swagger.v3.oas.annotations.media.Schema
import jakarta.validation.constraints.*
import java.time.Instant
import java.util.UUID
import ru.lastochka.common.Metadata

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
    @field:Schema(nullable = true) val desiredSessionId: UUID? = null,
    @field:Schema(nullable = true) val desiredSessionVersion: Long? = null,
    @field:Schema(nullable = true)
    @field:Size(max = Metadata.Concept.MAX_COMMENT)
    val comment: String? = null,
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
)

data class EnquiryPage(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val items: List<EnquiryView>,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val total: Long,
)
