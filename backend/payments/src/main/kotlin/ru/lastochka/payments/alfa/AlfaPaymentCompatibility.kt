package ru.lastochka.payments.alfa

import org.springframework.stereotype.Service
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.conflict
import ru.lastochka.payments.repo.AlfaTestAttemptQueries

/** Legacy clients cannot label or display production payments as test payments. */
@Service
class AlfaPaymentCompatibility(private val selection: AlfaGatewaySelection, private val attempts: AlfaTestAttemptQueries) {
    fun requireCompatible(clientVersion: String?) {
        if (clientVersion == "2") return
        if (selection.productionSelected() || attempts.existsByEnvironment(Metadata.AlfaConnection.PRODUCTION_ENVIRONMENT))
            conflict(Metadata.Concept.PAYMENT_PROVIDER_NOT_CONFIGURED)
    }

    fun requireProductionClient(clientVersion: String?) {
        if (clientVersion != "2") conflict(Metadata.Concept.PAYMENT_PROVIDER_NOT_CONFIGURED)
    }
}
