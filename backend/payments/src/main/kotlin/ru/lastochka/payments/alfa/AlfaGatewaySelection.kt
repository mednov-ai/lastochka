package ru.lastochka.payments.alfa

import io.swagger.v3.oas.annotations.media.Schema
import java.time.Clock
import java.util.UUID
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.context.request.RequestContextHolder
import org.springframework.web.context.request.ServletRequestAttributes
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.conflict
import ru.lastochka.common.error.forbidden
import ru.lastochka.common.error.unauthorized
import ru.lastochka.common.service.CommandService
import ru.lastochka.identity.service.LoginSessionService
import ru.lastochka.payments.repo.AlfaGatewaySelectionRepository

data class AlfaGatewaySelectionView(
    @field:Schema(nullable = true) val activeEnvironment: AlfaGatewayEnvironment?,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val revision: Long,
)

class AlfaGatewaySelectionRequest(
    @field:Schema(nullable = true) val environment: AlfaGatewayEnvironment?,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val expectedRevision: Long,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val productionConfirmed: Boolean,
)

@Service
class AlfaGatewaySelection(
    private val repository: AlfaGatewaySelectionRepository,
    private val testConfig: AlfaConfigurationService,
    private val productionConfig: AlfaProductionConfigurationService,
    private val commands: CommandService,
    private val login: LoginSessionService,
    private val clock: Clock,
) {
    private fun state() = repository.findById(1).orElseThrow()
    private fun parse(value: String?): AlfaGatewayEnvironment? = when (value) {
        Metadata.AlfaConnection.TEST_ENVIRONMENT -> AlfaGatewayEnvironment.TEST
        Metadata.AlfaConnection.PRODUCTION_ENVIRONMENT -> AlfaGatewayEnvironment.PRODUCTION
        null -> null
        else -> AlfaGatewayEnvironment.UNKNOWN
    }
    @Transactional(readOnly = true)
    fun view(): AlfaGatewaySelectionView = state().let { AlfaGatewaySelectionView(parse(it.activeEnvironment), it.revision) }

    /** Legacy test-order endpoints must never create an order when another mode is selected. */
    fun testSelected(): Boolean = repository.findById(1).orElse(null)?.activeEnvironment == Metadata.AlfaConnection.TEST_ENVIRONMENT
    fun productionSelected(): Boolean = repository.findById(1).orElse(null)?.activeEnvironment == Metadata.AlfaConnection.PRODUCTION_ENVIRONMENT
    fun currentEnvironment(): AlfaGatewayEnvironment? = parse(repository.findById(1).orElse(null)?.activeEnvironment)

    @Transactional
    fun select(actor: UUID, input: AlfaGatewaySelectionRequest): AlfaGatewaySelectionView {
        commands.lockStudio()
        val request = (RequestContextHolder.getRequestAttributes() as? ServletRequestAttributes)?.request
        if (request != null) {
            val auth = SecurityContextHolder.getContext().authentication ?: unauthorized(Metadata.ErrorCodes.AUTH_REQUIRED)
            val account = login.requireStage(request, auth)
            if (account.id != actor || account.role != Metadata.Identity.ADMIN) forbidden(Metadata.ErrorCodes.ACCESS_DENIED)
        }
        val current = state()
        if (current.revision != input.expectedRevision) conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
        when (input.environment) {
            null -> Unit
            AlfaGatewayEnvironment.TEST -> if (testConfig.activeVersion() == null) conflict(Metadata.Concept.PAYMENT_PROVIDER_NOT_CONFIGURED)
            AlfaGatewayEnvironment.PRODUCTION -> if (!input.productionConfirmed || productionConfig.activeVersion() == null)
                conflict(Metadata.Concept.PAYMENT_PROVIDER_NOT_CONFIGURED)
            AlfaGatewayEnvironment.UNKNOWN -> conflict(Metadata.Concept.PAYMENT_PROVIDER_NOT_CONFIGURED)
        }
        val before = view()
        current.activeEnvironment = input.environment?.name
        current.revision += 1
        current.updatedAt = clock.instant()
        current.updatedBy = actor
        repository.save(current)
        val after = view()
        commands.audit(actor, actor, Metadata.AlfaConnection.GATEWAY_SELECTION_CHANGED, before, after)
        return after
    }
}
