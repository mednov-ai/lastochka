package ru.lastochka.identity.repo

import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import ru.lastochka.identity.entity.StoredSession

interface SessionRevocationRepository : JpaRepository<StoredSession, String> {
    @Modifying
    @Query(
        "delete from StoredSession s where s.principalName = :principal and (:keep is null or s.sessionId <> :keep)"
    )
    fun revokeSessions(principal: String, keep: String?): Int
}
