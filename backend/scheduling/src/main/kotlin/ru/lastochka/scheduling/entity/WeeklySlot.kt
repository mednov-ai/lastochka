package ru.lastochka.scheduling.entity

import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.util.UUID

@Entity
@Table(name = "weekly_intervals")
class WeeklySlot(
    @Id val id: UUID,
    var revision: Long,
    var directionId: UUID,
    var weekday: Int,
    var startMinute: Int,
    var durationMinutes: Int,
)
