package ru.lastochka.scheduling.repo

import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import ru.lastochka.scheduling.entity.StudioSession

interface StudioSessionRepository : JpaRepository<StudioSession, UUID> {
    fun findByIdInAndStartsAtLessThanEqual(
        ids: Collection<UUID>,
        now: java.time.Instant,
    ): List<StudioSession>
}
