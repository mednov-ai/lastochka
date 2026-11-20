package ru.lastochka.enquiries.repo

import java.time.Clock
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository
import ru.lastochka.common.Metadata
import ru.lastochka.enquiries.dto.*
import ru.lastochka.enquiries.entity.EnquiryEntity

interface EnquiryReplayProjection {
    val requestHash: String
    val enquiryId: UUID
}

interface EnquiryQueries : JpaRepository<EnquiryEntity, UUID> {
    // Native SQL: сохранить исходные серверные значения и семантику операции.
    @Query(
        value =
            "SELECT request_hash AS \"requestHash\",enquiry_id AS \"enquiryId\" FROM enquiry_replays WHERE key=:key AND expires_at>now()",
        nativeQuery = true,
    )
    fun replay(key: UUID): EnquiryReplayProjection?

    // Блокировка PostgreSQL сериализует повтор одной команды до проверки результата.
    // Native SQL: сохранить блокировку PostgreSQL.
    @Query(value = "SELECT pg_advisory_xact_lock(hashtextextended(:key,0))", nativeQuery = true)
    fun lockKey(key: String): Any

    @Modifying
    // Native SQL: сохранить исходные серверные значения и семантику операции.
    @Query(
        value =
            "INSERT INTO enrollment_requests(id,parent_name,phone,child_name,child_age,desired_session_snapshot,comment,created_at,participant_type,participant_age,age_direction_id,age_direction_title,age_direction_from,age_direction_to,age_direction_open_ended,participant_name,weekly_series_id,weekly_revision) VALUES(:id,:parent,:phone,:child,:age,:snapshot,:comment,:now,:participantType,:participantAge,:directionId,:directionTitle,:directionFrom,:directionTo,:directionOpenEnded,:participantName,:weeklyId,:weeklyRevision)",
        nativeQuery = true,
    )
    fun insert(
        id: UUID,
        parent: String,
        phone: String,
        child: String?,
        age: Int?,
        snapshot: String?,
        comment: String?,
        now: OffsetDateTime,
        participantType: String?,
        participantAge: Int?,
        directionId: UUID?,
        directionTitle: String?,
        directionFrom: Int?,
        directionTo: Int?,
        directionOpenEnded: Boolean?,
        participantName: String?,
        weeklyId: UUID?,
        weeklyRevision: Long?,
    ): Int

    // Конкурирующие повторы сохраняют атомарный PostgreSQL upsert.
    @Modifying
    // Native SQL: сохранить атомарный upsert.
    @Query(
        value =
            "INSERT INTO enquiry_replays(key,request_hash,enquiry_id,expires_at) VALUES(:key,:hash,:id,:expires) ON CONFLICT(key) DO UPDATE SET request_hash=excluded.request_hash,enquiry_id=excluded.enquiry_id,expires_at=excluded.expires_at",
        nativeQuery = true,
    )
    fun saveReplay(key: UUID, hash: String, id: UUID, expires: OffsetDateTime): Int

    fun findAllByOrderByCreatedAtDescIdDesc(page: Pageable): List<EnquiryEntity>
}

@Repository
class EnquiryRepository(private val queries: EnquiryQueries, private val clock: Clock) {
    fun replay(key: UUID): Pair<String, UUID>? =
        queries.replay(key)?.let { it.requestHash to it.enquiryId }

    fun lock(key: UUID) {
        queries.lockKey(key.toString())
    }

    fun insert(
        id: UUID,
        input: EnquiryInput,
        snapshot: String?,
        direction: EnquiryAgeDirection?,
    ): EnquiryView {
        queries.insert(
            id,
            input.parentName,
            input.phone,
            input.childName,
            input.childAge,
            snapshot,
            input.comment,
            clock.instant().atOffset(ZoneOffset.UTC),
            input.participantType?.name,
            input.participantAge,
            direction?.id,
            direction?.title,
            direction?.ageFrom,
            direction?.ageTo,
            direction?.ageOpenEnded,
            input.participantName,
            input.weeklyPreference?.seriesId,
            input.weeklyPreference?.revision,
        )
        return requireNotNull(find(id))
    }

    fun saveReplay(key: UUID, hash: String, id: UUID) {
        queries.saveReplay(
            key,
            hash,
            id,
            clock.instant().plusSeconds(Metadata.Concept.REPLAY_SECONDS).atOffset(ZoneOffset.UTC),
        )
    }

    private fun map(r: EnquiryEntity) =
        EnquiryView(
            r.id,
            r.number,
            r.parentName,
            r.phone,
            r.childName,
            r.childAge,
            r.desiredSessionSnapshot,
            r.comment,
            r.createdAt,
            r.participantType?.let(EnquiryParticipantType::valueOf),
            r.participantAge,
            r.ageDirectionId?.let { id ->
                EnquiryAgeDirection(
                    id,
                    requireNotNull(r.ageDirectionTitle),
                    requireNotNull(r.ageDirectionFrom),
                    r.ageDirectionTo,
                    requireNotNull(r.ageDirectionOpenEnded),
                )
            },
            r.participantName,
        )

    fun find(id: UUID): EnquiryView? = queries.findById(id).orElse(null)?.let(::map)

    fun page(page: Int): EnquiryPage =
        EnquiryPage(
            queries
                .findAllByOrderByCreatedAtDescIdDesc(
                    PageRequest.of(page, Metadata.Concept.PAGE_SIZE)
                )
                .map(::map),
            queries.count(),
        )
}
