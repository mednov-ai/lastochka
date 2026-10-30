package ru.lastochka.identity.repo

import java.sql.ResultSet
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import ru.lastochka.identity.dto.UserView
import ru.lastochka.identity.entity.Account

@Repository
class UserPasswordRepository(private val jdbc: JdbcClient) {
    private fun account(rs: ResultSet): Account =
        Account(
            id = rs.getObject("id", UUID::class.java),
            email = rs.getString("email"),
            name = rs.getString("name"),
            passwordHash = rs.getString("password_hash"),
            role = rs.getString("role"),
            login = rs.getString("login"),
            adminEnabled = rs.getBoolean("admin_enabled"),
            authVersion = rs.getLong("auth_version"),
            verifiedAt = rs.getTimestamp("verified_at")?.toInstant(),
            createdAt = rs.getTimestamp("created_at").toInstant(),
            mustChangePassword = rs.getBoolean("must_change_password"),
            temporaryPasswordExpiresAt =
                rs.getTimestamp("temporary_password_expires_at")?.toInstant(),
        )

    fun find(id: UUID): Account? =
        jdbc
            .sql("SELECT * FROM accounts WHERE id=:id")
            .param("id", id)
            .query { rs, _ -> account(rs) }
            .optional()
            .orElse(null)

    fun findPrincipal(principal: String): Account? =
        jdbc
            .sql("SELECT * FROM accounts WHERE email=:email")
            .param("email", principal)
            .query { rs, _ -> account(rs) }
            .optional()
            .orElse(null)

    fun lock(id: UUID): Account? =
        jdbc
            .sql("SELECT * FROM accounts WHERE id=:id FOR UPDATE")
            .param("id", id)
            .query { rs, _ -> account(rs) }
            .optional()
            .orElse(null)

    fun list(page: Int, size: Int): List<UserView> =
        jdbc
            .sql(
                "SELECT * FROM accounts WHERE role='ADMIN' AND admin_enabled ORDER BY created_at,id LIMIT :size OFFSET :offset"
            )
            .param("size", size)
            .param("offset", page.toLong() * size)
            .query { rs, _ -> view(account(rs)) }
            .list()

    fun count(): Long =
        jdbc
            .sql("SELECT count(*) FROM accounts WHERE role='ADMIN' AND admin_enabled")
            .query(Long::class.java)
            .single()

    fun create(a: Account): Int =
        jdbc
            .sql(
                """INSERT INTO accounts(id,email,name,password_hash,role,login,admin_enabled,verified_at,created_at,must_change_password,temporary_password_expires_at)
        VALUES(:id,:email,:name,:hash,'ADMIN',:login,true,:now,:now,true,:expires) ON CONFLICT(login) DO NOTHING"""
            )
            .param("id", a.id)
            .param("email", a.email)
            .param("name", a.name)
            .param("hash", a.passwordHash)
            .param("login", a.login)
            .param("now", a.createdAt.atOffset(ZoneOffset.UTC))
            .param("expires", a.temporaryPasswordExpiresAt!!.atOffset(ZoneOffset.UTC))
            .update()

    fun password(id: UUID, revision: Long, hash: String, expires: Instant?): Int =
        jdbc
            .sql(
                """UPDATE accounts SET password_hash=:hash,auth_version=auth_version+1,
        must_change_password=:temporary,temporary_password_expires_at=:expires WHERE id=:id AND auth_version=:revision"""
            )
            .param("id", id)
            .param("revision", revision)
            .param("hash", hash)
            .param("temporary", expires != null)
            .param(
                "expires",
                expires?.atOffset(ZoneOffset.UTC),
                java.sql.Types.TIMESTAMP_WITH_TIMEZONE,
            )
            .update()

    fun revokeChallenges(id: UUID) =
        jdbc.sql("DELETE FROM webauthn_challenges WHERE account_id=:id").param("id", id).update()

    fun view(a: Account) =
        UserView(
            a.id,
            a.login.orEmpty(),
            a.name,
            a.role,
            a.mustChangePassword,
            a.temporaryPasswordExpiresAt,
            a.authVersion,
        )
}
