package ru.lastochka.enquiries.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "enrollment_requests")
class EnquiryEntity(
    @Id val id: UUID = UUID.randomUUID(),
    @Column(name = "public_number") val number: Long = 0,
    @Column(name = "parent_name") val parentName: String = "",
    val phone: String = "",
    @Column(name = "child_name") val childName: String? = null,
    @Column(name = "child_age") val childAge: Int? = null,
    @Column(name = "desired_session_snapshot") val desiredSessionSnapshot: String? = null,
    val comment: String? = null,
    @Column(name = "created_at") val createdAt: Instant = Instant.EPOCH,
    @Column(name = "participant_type") val participantType: String? = null,
    @Column(name = "participant_age") val participantAge: Int? = null,
    @Column(name = "age_direction_id") val ageDirectionId: UUID? = null,
    @Column(name = "age_direction_title") val ageDirectionTitle: String? = null,
    @Column(name = "age_direction_from") val ageDirectionFrom: Int? = null,
    @Column(name = "age_direction_to") val ageDirectionTo: Int? = null,
    @Column(name = "age_direction_open_ended") val ageDirectionOpenEnded: Boolean? = null,
    @Column(name = "participant_name") val participantName: String? = null,
)
