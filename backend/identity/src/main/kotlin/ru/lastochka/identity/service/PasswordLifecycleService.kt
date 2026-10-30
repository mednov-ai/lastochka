package ru.lastochka.identity.service

import java.time.Clock
import java.util.UUID
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.*
import ru.lastochka.common.service.CommandService
import ru.lastochka.identity.dto.ChangePasswordRequest
import ru.lastochka.identity.entity.Account
import ru.lastochka.identity.repo.SessionRevocationRepository
import ru.lastochka.identity.repo.UserPasswordRepository
import ru.lastochka.identity.validation.PasswordPolicy

/** Account password operations deliberately do not grant or infer roles. */
@Service
class PasswordLifecycleService(
    private val storage: UserPasswordRepository,
    private val sessions: SessionRevocationRepository,
    private val passwords: PasswordEncoder,
    private val commands: CommandService,
    private val clock: Clock,
) {
    fun validate(value: String, field: String) {
        PasswordPolicy.failure(value)?.let { throw FieldValidationException(mapOf(field to it)) }
    }

    @Transactional
    fun temporary(id: UUID, revision: Long, value: String, actor: UUID?): Account {
        commands.lockStudio()
        validate(value, "temporaryPassword")
        val a = storage.lock(id) ?: notFound(Metadata.ErrorCodes.NOT_FOUND)
        if (a.authVersion != revision) conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
        update(a, value, true, actor, Metadata.PasswordLifecycle.RESET)
        return storage.find(id)!!
    }

    @Transactional
    fun change(id: UUID, revision: Long, input: ChangePasswordRequest): Account {
        commands.lockStudio()
        val a = storage.lock(id) ?: unauthorized(Metadata.ErrorCodes.AUTH_REQUIRED)
        if (a.authVersion != revision) conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
        if (a.mustChangePassword && a.temporaryPasswordExpiresAt?.isAfter(clock.instant()) != true)
            unauthorized(Metadata.ErrorCodes.AUTH_REQUIRED)
        if (!passwords.matches(input.currentPassword, a.passwordHash))
            throw FieldValidationException(
                mapOf("currentPassword" to Metadata.PasswordLifecycle.CURRENT_INVALID)
            )
        validate(input.newPassword, "newPassword")
        if (input.newPassword != input.confirmPassword)
            throw FieldValidationException(
                mapOf("confirmPassword" to Metadata.PasswordLifecycle.CONFIRM_MISMATCH)
            )
        if (passwords.matches(input.newPassword, a.passwordHash))
            throw FieldValidationException(
                mapOf("newPassword" to Metadata.PasswordLifecycle.SAME_PASSWORD)
            )
        update(
            a,
            input.newPassword,
            false,
            id,
            if (a.mustChangePassword) Metadata.PasswordLifecycle.FIRST_CHANGED
            else Metadata.PasswordLifecycle.CHANGED,
        )
        return storage.find(id)!!
    }

    private fun update(
        a: Account,
        value: String,
        temporary: Boolean,
        actor: UUID?,
        action: String,
    ) {
        val expires =
            if (temporary) clock.instant().plusSeconds(Metadata.PasswordLifecycle.TEMPORARY_SECONDS)
            else null
        if (
            storage.password(
                a.id,
                a.authVersion,
                requireNotNull(passwords.encode(value)),
                expires,
            ) != 1
        )
            conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
        storage.revokeChallenges(a.id)
        sessions.revokeSessions(a.email, null)
        commands.audit(a.id, actor, action, null, null)
    }
}
