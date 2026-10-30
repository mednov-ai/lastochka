package ru.lastochka.identity.repo

import org.springframework.security.web.webauthn.api.*
import org.springframework.security.web.webauthn.management.*
import org.springframework.stereotype.Repository

@Repository
class CredentialRepository(
    private val users: JdbcPublicKeyCredentialUserEntityRepository,
    private val credentials: JdbcUserCredentialRepository,
) {
    fun findUser(email: String) = users.findByUsername(email)

    fun findByUserId(id: Bytes) = credentials.findByUserId(id)

    fun findByCredentialId(id: Bytes) = credentials.findByCredentialId(id)

    fun delete(id: Bytes) = credentials.delete(id)

    fun save(record: CredentialRecord) = credentials.save(record)
}
