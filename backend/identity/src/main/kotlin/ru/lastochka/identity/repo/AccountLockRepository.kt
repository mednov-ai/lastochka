package ru.lastochka.identity.repo

import java.util.UUID
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.security.web.webauthn.api.*
import org.springframework.security.web.webauthn.management.*
import org.springframework.stereotype.Repository
import ru.lastochka.identity.dto.*

@Repository
class AccountLockRepository(private val jdbc: JdbcClient) {
    fun lock(id: java.util.UUID) =
        jdbc
            .sql("SELECT id FROM accounts WHERE id=:id FOR UPDATE")
            .param("id", id)
            .query(java.util.UUID::class.java)
            .single()

    fun authVersion(id: java.util.UUID) =
        jdbc
            .sql("SELECT auth_version FROM accounts WHERE id=:id")
            .param("id", id)
            .query(Long::class.java)
            .single()
}
