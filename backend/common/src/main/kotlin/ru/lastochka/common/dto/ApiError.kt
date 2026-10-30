package ru.lastochka.common.dto

import io.swagger.v3.oas.annotations.media.Schema

data class ApiError(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val type: String = "about:blank",
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val title: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val status: Int,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val code: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val detail: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val requestId: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val fieldErrors: Map<String, String> = emptyMap(),
)
