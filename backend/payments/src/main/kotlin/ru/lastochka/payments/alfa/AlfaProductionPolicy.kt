package ru.lastochka.payments.alfa

import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import ru.lastochka.common.Metadata
import ru.lastochka.payments.repo.AlfaConfigurationRepository

/** A production flag cannot grant access on a test database or an unclassified deployment. */
@Component
class AlfaProductionPolicy(
    configurations: AlfaConfigurationRepository,
    @Value(Metadata.AlfaConnection.PRODUCTION_ALLOWED) private val allowed: Boolean,
    @Value(Metadata.AlfaConnection.DEPLOYMENT_ZONE) private val zone: String,
) {
    init {
        if (allowed) {
            check(zone == "production") { "Alfa production requires production deployment identity" }
            val databaseZone = try {
                configurations.deploymentEnvironments().single()
            } catch (_: Exception) {
                throw IllegalStateException("Alfa production requires verified database identity")
            }
            check(databaseZone == "production") { "Alfa production forbidden for this database" }
        }
    }

    fun productionAllowed(): Boolean = allowed && zone == "production"
}
