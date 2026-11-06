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
import ru.lastochka.identity.entity.StaffPermission
import ru.lastochka.identity.entity.StaffPermissionId
import ru.lastochka.identity.repo.StaffPermissionRepository
import ru.lastochka.identity.repo.UserPasswordRepository

@Service
class UserManagementService(
    private val storage: UserPasswordRepository,
    private val staff: StaffPermissionRepository,
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
        val requested = validateAccess(input.role, input.permissions)
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
                role = input.role,
                login = login,
                adminEnabled = true,
                verifiedAt = clock.instant(),
                createdAt = clock.instant(),
                mustChangePassword = true,
                temporaryPasswordExpiresAt =
                    clock.instant().plusSeconds(Metadata.PasswordLifecycle.TEMPORARY_SECONDS),
            )
        if (storage.create(a) != 1) conflict(Metadata.PasswordLifecycle.LOGIN_CONFLICT)
        replacePermissions(id, requested)
        commands.audit(id, actor.id, Metadata.PasswordLifecycle.CREATED, null, null)
        if (input.role == Metadata.StaffAccess.STAFF)
            commands.audit(id, actor.id, Metadata.StaffAccess.CHANGED, null, UserAccessAudit(input.role, requested))
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
        if (target.role !in setOf(Metadata.Identity.ADMIN, Metadata.StaffAccess.STAFF) || !target.adminEnabled)
            forbidden(Metadata.ErrorCodes.ACCESS_DENIED)
        return storage.view(
            lifecycle.temporary(id, input.revision, input.temporaryPassword, actor.id)
        )
    }

    @Transactional
    fun changeAccess(req: HttpServletRequest, auth: Authentication, id: UUID, input: UserAccessRequest): UserView {
        commands.lockStudio()
        val actor = admin(auth)
        sessions.requireStage(req, auth)
        val requested = validateAccess(input.role, input.permissions)
        val target = storage.lock(id) ?: notFound(Metadata.ErrorCodes.NOT_FOUND)
        if (!target.adminEnabled) forbidden(Metadata.ErrorCodes.ACCESS_DENIED)
        if (target.permissionRevision != input.revision) conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
        if (target.role == Metadata.Identity.ADMIN && input.role != Metadata.Identity.ADMIN && storage.adminCount() <= 1)
            conflict(Metadata.StaffAccess.LAST_ADMIN)
        val before = UserAccessAudit(target.role, staff.permissions(id))
        if (storage.changeAccess(id, requireNotNull(input.revision), input.role) != 1) conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
        replacePermissions(id, requested)
        commands.audit(id, actor.id, Metadata.StaffAccess.CHANGED, before, UserAccessAudit(input.role, requested))
        return storage.view(storage.find(id) ?: notFound(Metadata.ErrorCodes.NOT_FOUND))
    }

    private fun validateAccess(role: String, selected: Set<String>): Set<String> {
        if (role !in setOf(Metadata.Identity.ADMIN, Metadata.StaffAccess.STAFF))
            throw FieldValidationException(mapOf("role" to Metadata.ErrorCodes.FIELD_INVALID))
        if (!Metadata.StaffAccess.ALL.containsAll(selected) || (role == Metadata.Identity.ADMIN && selected.isNotEmpty()))
            throw FieldValidationException(mapOf("permissions" to Metadata.ErrorCodes.FIELD_INVALID))
        return selected +
            (if (Metadata.StaffAccess.SCHEDULE_EDIT in selected) setOf(Metadata.StaffAccess.SCHEDULE_VIEW) else emptySet()) +
            (if (Metadata.StaffAccess.PAYMENT_EDIT in selected) setOf(Metadata.StaffAccess.PAYMENT_VIEW) else emptySet())
    }

    private fun replacePermissions(id: UUID, selected: Set<String>) {
        staff.deleteForAccount(id)
        staff.saveAll(selected.map { StaffPermission(StaffPermissionId(id, it)) })
    }
}
