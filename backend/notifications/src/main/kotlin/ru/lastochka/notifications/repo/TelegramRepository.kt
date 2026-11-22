package ru.lastochka.notifications.repo

import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository
import ru.lastochka.notifications.dto.DeliveryView
import ru.lastochka.notifications.entity.TelegramOutboxEntity

interface TelegramView {
    val status: String
    val attempts: Int
    val error: String?
}

interface TelegramQueries : JpaRepository<TelegramOutboxEntity, UUID> {
    @Query(
        "select t.status as status,t.attempts as attempts,t.lastError as error from TelegramOutboxEntity t where t.enquiryId=:id"
    )
    fun view(id: UUID): TelegramView?
}

@Repository
class TelegramRepository(private val queries: TelegramQueries) {
    fun view(id: UUID): DeliveryView? =
        queries.view(id)?.let { DeliveryView(it.status, it.attempts, it.error, false) }
}
