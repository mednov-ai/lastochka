package ru.lastochka.identity.repo

import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import ru.lastochka.identity.entity.Account

interface AdminAccessRepository : JpaRepository<Account, UUID> {
    @Modifying
    @Query(
        "update Account a set a.login=:login, a.adminEnabled=true where a.id=:id and a.role='ADMIN' and (a.login is null or a.login=:login)"
    )
    fun provision(id: UUID, login: String): Int

    @Modifying
    @Query(
        "update Account a set a.passwordHash=:hash, a.authVersion=a.authVersion+1 where a.id=:id and a.role='ADMIN'"
    )
    fun reset(id: UUID, hash: String): Int

    @Modifying
    @Query("delete from StoredChallenge c where c.accountId=:id")
    fun revokeChallenges(id: UUID): Int
}
