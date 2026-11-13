package ru.lastochka.payments.alfa

import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import ru.lastochka.common.Metadata
import ru.lastochka.payments.utils.AlfaReturnUrl

/** Readiness is independent from viewing or storing a candidate and fails closed. */
@Component
class AlfaProductionReadiness(
    private val policy: AlfaProductionPolicy,
    private val productionBox: AlfaProductionSecretBox,
    private val testBox: AlfaSecretBox,
    @Value(Metadata.AlfaConnection.PRODUCTION_IMPLEMENTATION_CONFIRMED) private val implementationConfirmed: Boolean,
    @Value(Metadata.AlfaConnection.PRODUCTION_PROBE_CONFIRMED) private val probeConfirmed: Boolean,
    @Value(Metadata.AlfaConnection.PRODUCTION_FISCALIZATION_CONFIRMED) private val fiscalizationConfirmed: Boolean,
    @Value(Metadata.AlfaConnection.PRODUCTION_FORM_HOSTS) private val formHosts: String,
    @Value(Metadata.AlfaConnection.PRODUCTION_CURRENCY) private val currency: String,
    @Value(Metadata.AlfaConnection.PRODUCTION_CA_FILE) private val caFile: String,
    @Value(Metadata.AlfaPayment.PRODUCTION_RETURN_URL_SETTING) private val returnUrl: String,
    @Value(Metadata.Configuration.LASTOCHKA_ORIGIN) private val publicOrigin: String,
) {
    fun obstacles(): Set<AlfaProductionObstacle> {
        if (!policy.productionAllowed()) return setOf(AlfaProductionObstacle.FORBIDDEN)
        val problems = mutableSetOf<AlfaProductionObstacle>()
        if (!implementationConfirmed) problems.add(AlfaProductionObstacle.IMPLEMENTATION_UNVERIFIED)
        if (!productionBox.available()) problems.add(AlfaProductionObstacle.KEY_UNAVAILABLE)
        else if (testBox.available() && productionBox.sharesActiveKeyWith(testBox))
            problems.add(AlfaProductionObstacle.KEY_REUSED)
        if (!probeConfirmed) problems.add(AlfaProductionObstacle.PROBE_UNCONFIRMED)
        if (!fiscalizationConfirmed) problems.add(AlfaProductionObstacle.FISCALIZATION_UNCONFIRMED)
        val hosts = formHosts.split(',').map { it.trim().lowercase(java.util.Locale.ROOT) }
        val validHosts = hosts.isNotEmpty() && hosts.all { host ->
            host.isNotBlank() && runCatching {
                val uri = java.net.URI("https://$host/")
                uri.host == host && uri.port == -1 && uri.userInfo == null && uri.rawPath == "/" && uri.query == null && uri.fragment == null
            }.getOrDefault(false)
        }
        if (!validHosts) problems.add(AlfaProductionObstacle.FORM_HOSTS_UNCONFIRMED)
        if (currency !in setOf(Metadata.AlfaPayment.BANK_RUB, Metadata.AlfaPayment.ISO_RUB))
            problems.add(AlfaProductionObstacle.CURRENCY_UNCONFIRMED)
        if (!runCatching { alfaSslContext(caFile) }.isSuccess) problems.add(AlfaProductionObstacle.CERTIFICATE_UNAVAILABLE)
        if (!AlfaReturnUrl.allowedProduction(returnUrl, publicOrigin)) problems.add(AlfaProductionObstacle.RETURN_URL_UNCONFIRMED)
        return problems
    }
}

enum class AlfaProductionObstacle {
    FORBIDDEN, IMPLEMENTATION_UNVERIFIED, KEY_UNAVAILABLE, KEY_REUSED, PROBE_UNCONFIRMED, FISCALIZATION_UNCONFIRMED, FORM_HOSTS_UNCONFIRMED, CURRENCY_UNCONFIRMED, CERTIFICATE_UNAVAILABLE, RETURN_URL_UNCONFIRMED,
}
