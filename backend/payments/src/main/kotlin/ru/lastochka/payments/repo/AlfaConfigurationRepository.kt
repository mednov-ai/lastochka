package ru.lastochka.payments.repo

import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import ru.lastochka.payments.entity.AlfaConfigurationEntity
import ru.lastochka.payments.entity.AlfaCredentialsEntity

interface AlfaConfigurationRepository : JpaRepository<AlfaConfigurationEntity, Int>
interface AlfaCredentialsRepository : JpaRepository<AlfaCredentialsEntity, UUID>

interface AlfaLinkRotationRepository : JpaRepository<ru.lastochka.payments.entity.AlfaTestAttemptEntity, UUID> {
    @Query("select a from AlfaTestAttemptEntity a where a.linkCiphertext is not null")
    fun withLinks(): List<ru.lastochka.payments.entity.AlfaTestAttemptEntity>

    @Modifying
    @Query(value = "UPDATE alfa_test_attempts SET link_ciphertext=:ciphertext WHERE payment_id=:id", nativeQuery = true)
    fun replaceLink(id: UUID, ciphertext: ByteArray): Int
}
