package ru.lastochka.identity.repo

import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository

@Repository
class SessionRevocationRepository(private val jdbc: JdbcClient) {
    fun revokeSessions(principal: String, keepSession: String?) =
        jdbc
            .sql(
                "DELETE FROM spring_session WHERE principal_name=:principal AND (:keep IS NULL OR session_id<>:keep)"
            )
            .param("principal", principal)
            .param("keep", keepSession, java.sql.Types.VARCHAR)
            .update()
}
