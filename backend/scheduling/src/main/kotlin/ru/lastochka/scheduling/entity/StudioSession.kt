package ru.lastochka.scheduling.entity

import jakarta.persistence.*
import java.time.Instant
import java.util.UUID
import ru.lastochka.common.Metadata

@Entity
@Table(name = "studio_sessions")
class StudioSession(
    @Id val id: UUID = UUID.randomUUID(),
    var title: String,
    var format: String,
    @Column(name = "starts_at") var startsAt: Instant,
    @Column(name = "ends_at") var endsAt: Instant,
    var capacity: Int,
    var status: String = Metadata.Scheduling.DRAFT,
    @Version var version: Long = 0,
    @Column(name = "age_from") var ageFrom: Int? = null,
    @Column(name = "age_to") var ageTo: Int? = null,
)
