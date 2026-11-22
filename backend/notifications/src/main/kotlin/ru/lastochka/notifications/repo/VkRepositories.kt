package ru.lastochka.notifications.repo

import jakarta.persistence.LockModeType
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import ru.lastochka.notifications.entity.VkOutboxEntity
import ru.lastochka.notifications.entity.VkSettingsEntity

interface VkSettingsRepository : JpaRepository<VkSettingsEntity, Int> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from VkSettingsEntity s where s.id = 1")
    fun locked(): VkSettingsEntity

    @Query("select s from VkSettingsEntity s where s.id = 1") fun current(): VkSettingsEntity

    // One PostgreSQL sequence supplies unique random_id values to tests and deliveries.
    @Query(value = "select nextval('vk_enquiry_random_id_seq')", nativeQuery = true)
    fun nextRandomId(): Int
}

interface VkOutboxRepository : JpaRepository<VkOutboxEntity, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select o from VkOutboxEntity o where o.enquiryId = :id")
    fun locked(id: UUID): VkOutboxEntity?

    // SKIP LOCKED prevents concurrent workers from claiming the same message.
    @Query(
        value =
            """
            SELECT * FROM vk_enquiry_outbox WHERE destination_id = :destination
              AND status IN ('PENDING','RETRY_WAIT') AND next_attempt_at <= now()
              AND (lease_until IS NULL OR lease_until <= now())
            ORDER BY next_attempt_at, created_at, enquiry_id LIMIT 1 FOR UPDATE SKIP LOCKED
        """,
        nativeQuery = true,
    )
    fun next(destination: UUID): VkOutboxEntity?
}
