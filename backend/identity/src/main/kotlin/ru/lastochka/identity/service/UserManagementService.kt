package ru.lastochka.identity.service

import jakarta.servlet.http.HttpServletRequest
import java.time.Clock
import java.util.Locale
import java.util.UUID
import org.springframework.security.core.Authentication
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.*
import ru.lastochka.common.service.CommandService
import ru.lastochka.identity.dto.*
import ru.lastochka.identity.entity.Account
import ru.lastochka.identity.repo.UserPasswordRepository

@Service
class UserManagementService(
    private val storage: UserPasswordRepository,
    private val sessions: LoginSessionService,
    private val lifecycle: PasswordLifecycleService,
    private val passwords: PasswordEncoder,
    private val commands: CommandService,
    private val clock: Clock,
) {
    private fun admin(auth: Authentication): Account =
        sessions.account(auth).also {
            if (it.role != Metadata.Identity.ADMIN || !it.adminEnabled || it.mustChangePassword)
                forbidden(Metadata.ErrorCodes.ACCESS_DENIED)
        }

    @Transactional(readOnly = true)
    fun list(auth: Authentication, page: Int, size: Int): UserPage {
        admin(auth)
        if (page < 0 || size !in 1..Metadata.Limits.PAGE_SIZE_MAX)
            badRequest(Metadata.ErrorCodes.INVALID_PAGE)
        return UserPage(storage.list(page, size), storage.count(), page, size)
    }

    @Transactional
    fun create(req: HttpServletRequest, auth: Authentication, input: CreateUserRequest): UserView {
        commands.lockStudio()
        val actor = admin(auth)
        sessions.requireStage(req, auth)
        if (input.role != Metadata.Identity.ADMIN)
            throw FieldValidationException(mapOf("role" to Metadata.ErrorCodes.FIELD_INVALID))
        val login = input.login.trim().lowercase(Locale.ROOT)
        if (!Regex(Metadata.Concept.LOGIN_PATTERN).matches(login))
            throw FieldValidationException(mapOf("login" to Metadata.ErrorCodes.FIELD_INVALID))
        lifecycle.validate(input.temporaryPassword, "temporaryPassword")
        val id = UUID.randomUUID()
        val a =
            Account(
                id = id,
                email = "$id@accounts.lastochka.invalid",
                name = input.name.trim(),
                passwordHash = requireNotNull(passwords.encode(input.temporaryPassword)),
                role = Metadata.Identity.ADMIN,
                login = login,
                adminEnabled = true,
                verifiedAt = clock.instant(),
                createdAt = clock.instant(),
                mustChangePassword = true,
                temporaryPasswordExpiresAt =
                    clock.instant().plusSeconds(Metadata.PasswordLifecycle.TEMPORARY_SECONDS),
            )
        if (storage.create(a) != 1) conflict(Metadata.PasswordLifecycle.LOGIN_CONFLICT)
        commands.audit(id, actor.id, Metadata.PasswordLifecycle.CREATED, null, null)
        return storage.view(a)
    }

    @Transactional
    fun reset(
        req: HttpServletRequest,
        auth: Authentication,
        id: UUID,
        input: TemporaryPasswordRequest,
    ): UserView {
        commands.lockStudio()
        val actor = admin(auth)
        sessions.requireStage(req, auth)
        if (actor.id == id) forbidden(Metadata.PasswordLifecycle.SELF_RESET)
        val target = storage.find(id) ?: notFound(Metadata.ErrorCodes.NOT_FOUND)
        if (target.role != Metadata.Identity.ADMIN || !target.adminEnabled)
            forbidden(Metadata.ErrorCodes.ACCESS_DENIED)
        return storage.view(
            lifecycle.temporary(id, input.revision, input.temporaryPassword, actor.id)
        )
    }
}
