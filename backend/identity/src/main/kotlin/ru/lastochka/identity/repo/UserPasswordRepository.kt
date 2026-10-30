package ru.lastochka.identity.repo

import jakarta.persistence.LockModeType
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository
import ru.lastochka.identity.dto.UserView
import ru.lastochka.identity.entity.Account

interface PasswordAccountProjection {
    val id: UUID
    val email: String
    val name: String
    val passwordHash: String
    val role: String
    val login: String?
    val adminEnabled: Boolean
    val authVersion: Long
    val verifiedAt: Instant?
    val createdAt: Instant
    val mustChangePassword: Boolean
    val temporaryPasswordExpiresAt: Instant?
}

interface UserPasswordQueries : JpaRepository<Account, UUID> {
    @Query(
        "select a.id as id,a.email as email,a.name as name,a.passwordHash as passwordHash,a.role as role,a.login as login,a.adminEnabled as adminEnabled,a.authVersion as authVersion,a.verifiedAt as verifiedAt,a.createdAt as createdAt,a.mustChangePassword as mustChangePassword,a.temporaryPasswordExpiresAt as temporaryPasswordExpiresAt from Account a where a.id=:id"
    )
    fun view(id: UUID): PasswordAccountProjection?

    @Query(
        "select a.id as id,a.email as email,a.name as name,a.passwordHash as passwordHash,a.role as role,a.login as login,a.adminEnabled as adminEnabled,a.authVersion as authVersion,a.verifiedAt as verifiedAt,a.createdAt as createdAt,a.mustChangePassword as mustChangePassword,a.temporaryPasswordExpiresAt as temporaryPasswordExpiresAt from Account a where a.email=:principal"
    )
    fun principal(principal: String): PasswordAccountProjection?

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
        "select a.id as id,a.email as email,a.name as name,a.passwordHash as passwordHash,a.role as role,a.login as login,a.adminEnabled as adminEnabled,a.authVersion as authVersion,a.verifiedAt as verifiedAt,a.createdAt as createdAt,a.mustChangePassword as mustChangePassword,a.temporaryPasswordExpiresAt as temporaryPasswordExpiresAt from Account a where a.id=:id"
    )
    fun lock(id: UUID): PasswordAccountProjection?

    @Query(
        "select a.id as id,a.email as email,a.name as name,a.passwordHash as passwordHash,a.role as role,a.login as login,a.adminEnabled as adminEnabled,a.authVersion as authVersion,a.verifiedAt as verifiedAt,a.createdAt as createdAt,a.mustChangePassword as mustChangePassword,a.temporaryPasswordExpiresAt as temporaryPasswordExpiresAt from Account a where a.role='ADMIN' and a.adminEnabled=true order by a.createdAt,a.id"
    )
    fun list(page: Pageable): List<PasswordAccountProjection>

    @Query("select count(a) from Account a where a.role='ADMIN' and a.adminEnabled=true")
    fun adminCount(): Long

    // Конфликт логина проверяется атомарно на уровне PostgreSQL.
    @Modifying
    // Native SQL: сохранить атомарный upsert.
    @Query(
        value =
            """INSERT INTO accounts(id,email,name,password_hash,role,login,admin_enabled,verified_at,created_at,must_change_password,temporary_password_expires_at)
        VALUES(:id,:email,:name,:hash,'ADMIN',:login,true,:now,:now,true,:expires) ON CONFLICT(login) DO NOTHING""",
        nativeQuery = true,
    )
    fun create(
        id: UUID,
        email: String,
        name: String,
        hash: String,
        login: String?,
        now: OffsetDateTime,
        expires: OffsetDateTime,
    ): Int

    @Modifying
    @Query(
        "update Account a set a.passwordHash=:hash,a.authVersion=a.authVersion+1,a.mustChangePassword=:temporary,a.temporaryPasswordExpiresAt=:expires where a.id=:id and a.authVersion=:revision"
    )
    fun password(id: UUID, revision: Long, hash: String, temporary: Boolean, expires: Instant?): Int

    @Modifying
    @Query("delete from StoredChallenge c where c.accountId=:id")
    fun revokeChallenges(id: UUID): Int
}

@Repository
class UserPasswordRepository(private val queries: UserPasswordQueries) {
    private fun account(r: PasswordAccountProjection) =
        Account(
            id = r.id,
            email = r.email,
            name = r.name,
            passwordHash = r.passwordHash,
            role = r.role,
            login = r.login,
            adminEnabled = r.adminEnabled,
            authVersion = r.authVersion,
            verifiedAt = r.verifiedAt,
            createdAt = r.createdAt,
            mustChangePassword = r.mustChangePassword,
            temporaryPasswordExpiresAt = r.temporaryPasswordExpiresAt,
        )

    fun find(id: UUID): Account? = queries.view(id)?.let(::account)

    fun findPrincipal(principal: String): Account? = queries.principal(principal)?.let(::account)

    fun lock(id: UUID): Account? = queries.lock(id)?.let(::account)

    fun list(page: Int, size: Int): List<UserView> =
        queries.list(PageRequest.of(page, size)).map { view(account(it)) }

    fun count(): Long = queries.adminCount()

    fun create(a: Account): Int =
        queries.create(
            a.id,
            a.email,
            a.name,
            a.passwordHash,
            a.login,
            a.createdAt.atOffset(ZoneOffset.UTC),
            a.temporaryPasswordExpiresAt!!.atOffset(ZoneOffset.UTC),
        )

    fun password(id: UUID, revision: Long, hash: String, expires: Instant?): Int =
        queries.password(id, revision, hash, expires != null, expires)

    fun revokeChallenges(id: UUID): Int = queries.revokeChallenges(id)

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
