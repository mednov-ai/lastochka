package ru.lastochka.identity.repo

import jakarta.persistence.LockModeType
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import ru.lastochka.identity.entity.Account

interface AccountLockRepository : JpaRepository<Account, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a.id from Account a where a.id=:id")
    fun lock(id: UUID): UUID

    @Query("select a.authVersion from Account a where a.id=:id") fun authVersion(id: UUID): Long
}
