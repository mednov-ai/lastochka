package ru.lastochka.content.dto

import io.swagger.v3.oas.annotations.media.Schema

data class LandingBlock(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val id: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val kind: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val title: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val text: String,
    @field:Schema(nullable = true) val image: String? = null,
    @field:Schema(nullable = true) val alt: String? = null,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val items: List<String> = emptyList(),
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val motionPreset: String = "none",
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val visible: Boolean = true,
)

data class LandingContent(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val schemaVersion: Int = 1,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val revision: Long,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val title: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val description: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val phone: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val telegram: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val blocks: List<LandingBlock>,
)
