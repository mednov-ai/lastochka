package ru.lastochka.payments.repo

import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import ru.lastochka.payments.entity.AlfaConfigurationEntity
import ru.lastochka.payments.entity.AlfaCredentialsEntity

interface AlfaConfigurationRepository : JpaRepository<AlfaConfigurationEntity, Int> {
    @Query(value = "SELECT environment FROM deploy_guard.identity", nativeQuery = true)
    fun deploymentEnvironments(): List<String>
}
interface AlfaCredentialsRepository : JpaRepository<AlfaCredentialsEntity, UUID> {
    fun countByEnvironment(environment: String): Long
    fun findAllByEnvironment(environment: String): List<AlfaCredentialsEntity>
}

interface AlfaLinkRotationRepository : JpaRepository<ru.lastochka.payments.entity.AlfaTestAttemptEntity, UUID> {
    @Query("select a from AlfaTestAttemptEntity a where a.linkCiphertext is not null and a.environment = 'TEST'")
    fun withLinks(): List<ru.lastochka.payments.entity.AlfaTestAttemptEntity>

    @Query("select a from AlfaTestAttemptEntity a where a.linkCiphertext is not null and a.environment = 'PRODUCTION'")
    fun withProductionLinks(): List<ru.lastochka.payments.entity.AlfaTestAttemptEntity>

    @Modifying
    @Query(value = "UPDATE alfa_test_attempts SET link_ciphertext=:ciphertext WHERE payment_id=:id", nativeQuery = true)
    fun replaceLink(id: UUID, ciphertext: ByteArray): Int
}
