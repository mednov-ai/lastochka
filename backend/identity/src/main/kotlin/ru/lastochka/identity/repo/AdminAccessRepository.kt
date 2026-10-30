package ru.lastochka.identity.repo

import java.util.UUID
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository

@Repository
class AdminAccessRepository(private val jdbc: JdbcClient) {
    fun provision(id: UUID, login: String): Int =
        jdbc
            .sql(
                "UPDATE accounts SET login=:login,admin_enabled=true WHERE id=:id AND role='ADMIN' AND (login IS NULL OR login=:login)"
            )
            .param("id", id)
            .param("login", login)
            .update()

    fun reset(id: UUID, hash: String): Int =
        jdbc
            .sql(
                "UPDATE accounts SET password_hash=:hash,auth_version=auth_version+1 WHERE id=:id AND role='ADMIN'"
            )
            .param("id", id)
            .param("hash", hash)
            .update()

    fun revokeChallenges(id: UUID) {
        jdbc.sql("DELETE FROM webauthn_challenges WHERE account_id=:id").param("id", id).update()
    }
}
