package ru.lastochka.payments.alfa

import java.time.Instant
import java.util.UUID
import io.swagger.v3.oas.annotations.media.Schema

// Do not log these classes: they carry credentials or bearer URLs.
class AlfaCredentials(val login: String, val password: String, val merchantLogin: String? = null)
class AlfaRegisterResult(val orderId: String?, val formUrl: String?, val errorCode: String?)
class AlfaStatusResult(
    val orderNumber: String?, val orderId: String?, val amountMinor: Long?,
    val currency: String?, val orderStatus: Int?, val errorCode: String?,
)
class AlfaDeclineResult(val errorCode: String?)
data class AlfaConfigView(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val enabled: Boolean,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val configured: Boolean,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val candidatePresent: Boolean,
    @field:Schema(nullable = true) val candidateStatus: String?,
    @field:Schema(nullable = true) val updatedAt: Instant?,
    @field:Schema(nullable = true) val updatedBy: UUID?,
)
class AlfaCandidateRequest(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, accessMode = Schema.AccessMode.WRITE_ONLY)
    val login: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, accessMode = Schema.AccessMode.WRITE_ONLY)
    val password: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val testConfirmed: Boolean,
    @field:Schema(nullable = true, accessMode = Schema.AccessMode.WRITE_ONLY) val merchantLogin: String? = null,
)
class AlfaKeyRotationRequest(@field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val keyId: String)

enum class AlfaGatewayEnvironment { TEST, PRODUCTION, UNKNOWN }

interface AlfaBankGateway {
    val environment: AlfaGatewayEnvironment get() = AlfaGatewayEnvironment.UNKNOWN
    fun register(credentials: AlfaCredentials, orderNumber: String, amountMinor: Long, returnUrl: String): AlfaRegisterResult
    fun status(credentials: AlfaCredentials, orderId: String?, orderNumber: String?): AlfaStatusResult
    fun decline(credentials: AlfaCredentials, orderId: String?, orderNumber: String?): AlfaDeclineResult
}
