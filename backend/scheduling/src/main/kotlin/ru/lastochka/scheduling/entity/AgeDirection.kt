package ru.lastochka.scheduling.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.Version
import java.util.UUID

@Entity
@Table(name = "age_directions")
class AgeDirection(
    @Id val id: UUID = UUID.randomUUID(),
    var title: String,
    var description: String,
    @Column(name = "age_from") var ageFrom: Int,
    @Column(name = "age_to") var ageTo: Int?,
    @Column(name = "age_open_ended") var ageOpenEnded: Boolean,
    var active: Boolean,
    @Column(name = "sort_order") var sortOrder: Int,
    @Version var version: Long? = null,
)
