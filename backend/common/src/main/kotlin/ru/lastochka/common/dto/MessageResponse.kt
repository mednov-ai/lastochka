package ru.lastochka.common.dto

import io.swagger.v3.oas.annotations.media.Schema

data class MessageResponse(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val message: String
)
