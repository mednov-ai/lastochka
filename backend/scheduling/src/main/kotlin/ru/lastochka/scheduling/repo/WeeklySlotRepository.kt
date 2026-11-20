package ru.lastochka.scheduling.repo

import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import ru.lastochka.scheduling.entity.WeeklySlot

interface WeeklySlotRepository : JpaRepository<WeeklySlot, UUID> {
    // Never reuse a previously published reference, including superseded legacy revisions.
    @Query(value = "SELECT nextval('weekly_interval_revision')", nativeQuery = true)
    fun nextRevision(): Long
}
