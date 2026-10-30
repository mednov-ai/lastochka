package ru.lastochka.identity.repo

import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import ru.lastochka.identity.entity.Account

interface AccountRepository : JpaRepository<Account, UUID> {
    fun findByEmail(email: String): Account?

    fun findByLogin(login: String): Account?

    @org.springframework.data.jpa.repository.Lock(
        jakarta.persistence.LockModeType.PESSIMISTIC_WRITE
    )
    @org.springframework.data.jpa.repository.Query("select a from Account a where a.id=:id")
    fun lockedById(id: UUID): Account?
}
