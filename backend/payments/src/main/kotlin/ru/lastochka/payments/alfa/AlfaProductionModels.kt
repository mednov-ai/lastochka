package ru.lastochka.payments.alfa

import io.swagger.v3.oas.annotations.media.Schema
import java.time.Instant

class AlfaProductionCandidateRequest(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, accessMode = Schema.AccessMode.WRITE_ONLY)
    val login: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, accessMode = Schema.AccessMode.WRITE_ONLY)
    val password: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val productionConfirmed: Boolean,
)

data class AlfaProductionConfigView(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val allowed: Boolean,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val configured: Boolean,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val enabled: Boolean,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val candidatePresent: Boolean,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val activationReady: Boolean,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val obstacles: Set<AlfaProductionObstacle>,
    @field:Schema(nullable = true) val updatedAt: Instant?,
)
