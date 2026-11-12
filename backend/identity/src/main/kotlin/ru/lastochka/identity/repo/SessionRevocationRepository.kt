package ru.lastochka.identity.repo

import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import ru.lastochka.identity.entity.StoredSession

interface SessionRevocationRepository : JpaRepository<StoredSession, String> {
    @Query(
        value = "select * from spring_session where session_id = :sessionId and principal_name = :principal and expiry_time > :now for update",
        nativeQuery = true,
    )
    fun lockActive(sessionId: String, principal: String, now: Long): StoredSession?

    @Modifying
    @Query(
        "delete from StoredSession s where s.principalName = :principal and (:keep is null or s.sessionId <> :keep)"
    )
    fun revokeSessions(principal: String, keep: String?): Int
}
