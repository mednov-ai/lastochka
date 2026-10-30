package ru.lastochka.scheduling.dto

import io.swagger.v3.oas.annotations.media.Schema
import jakarta.validation.Valid
import java.time.Instant

data class DraftCommand(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val expectedSessionVersion: Long,
    @field:Schema(nullable = true) val expectedDraftVersion: Long? = null,
)

data class SaveSessionDraft(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val expectedSessionVersion: Long,
    @field:Schema(nullable = true) val expectedDraftVersion: Long? = null,
    @field:Valid
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val session: SessionInput,
)

data class SessionDraftView(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val version: Long,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val baseSessionVersion: Long,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val session: SessionInput,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val updatedAt: Instant,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val author: String,
)

data class SessionEditorView(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val session: SessionView,
    @field:Schema(nullable = true) val draft: SessionDraftView? = null,
)

data class SessionRevision(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val id: Long,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val action: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val occurredAt: Instant,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val author: String,
    @field:Schema(nullable = true) val before: SessionInput? = null,
    @field:Schema(nullable = true) val after: SessionInput? = null,
)

data class SessionHistory(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val items: List<SessionRevision>,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val total: Long,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val page: Int,
)
