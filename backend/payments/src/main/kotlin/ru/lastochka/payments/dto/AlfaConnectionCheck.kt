package ru.lastochka.payments.dto

import io.swagger.v3.oas.annotations.media.Schema
import java.time.Instant

enum class AlfaConnectionOutcome { CONFIRMED, UNCONFIRMED, BANK_UNAVAILABLE, NOT_CONFIGURED, SETTINGS_CHANGED }

data class AlfaConnectionCheck(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val outcome: AlfaConnectionOutcome,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val checkedAt: Instant,
)
