package ru.lastochka.identity.service

import java.time.Clock
import java.util.UUID
import org.springframework.http.HttpStatus
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.server.ResponseStatusException
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.unauthorized
import ru.lastochka.identity.dto.*
import ru.lastochka.identity.entity.Account
import ru.lastochka.identity.repo.AccountRepository
import ru.lastochka.identity.repo.StaffPermissionRepository

@Service
class AccountService(
    private val accounts: AccountRepository,
    private val staffPermissions: StaffPermissionRepository,
    private val passwords: PasswordEncoder,
    private val clock: Clock,
) {
    private val dummyHash = passwords.encode("unavailable-account-password")

    fun normalized(email: String) = email.trim().lowercase(java.util.Locale.ROOT)

    fun find(email: String): Account? = accounts.findByEmail(normalized(email))

    fun isVerified(email: String): Boolean =
        find(email)?.let { it.adminEnabled && it.role in setOf(Metadata.Identity.ADMIN, Metadata.StaffAccess.STAFF) } == true

    private fun byId(id: UUID): Account =
        accounts.findById(id).orElseThrow {
            ResponseStatusException(HttpStatus.NOT_FOUND, Metadata.ErrorCodes.NOT_FOUND)
        }

    fun password(email: String, password: String): Account {
        val a = accounts.findByLogin(normalized(email))
        val valid = passwords.matches(password, a?.passwordHash ?: dummyHash)
        if (
            a == null ||
                !valid ||
                !a.adminEnabled ||
                a.role !in setOf(Metadata.Identity.ADMIN, Metadata.StaffAccess.STAFF) ||
                (a.mustChangePassword &&
                    a.temporaryPasswordExpiresAt?.isAfter(clock.instant()) != true)
        )
            unauthorized(Metadata.ErrorCodes.INVALID_CREDENTIALS)
        return a
    }

    @Transactional
    fun createAdmin(email: String, name: String, password: String): Account {
        ru.lastochka.identity.validation.PasswordPolicy.requireNew(password)
        require(
            Regex(Metadata.Concept.LOGIN_PATTERN).matches(normalized(email).substringBefore("@"))
        )
        check(find(email) == null) { "Account already exists" }
        return accounts.saveAndFlush(
            Account(
                email = normalized(email),
                name = name,
                passwordHash = requireNotNull(passwords.encode(password)),
                role = Metadata.Identity.ADMIN,
                login = normalized(email).substringBefore("@"),
                adminEnabled = true,
                verifiedAt = clock.instant(),
                createdAt = clock.instant(),
            )
        )
    }

    fun view(a: Account) = AccountView(a.id, a.login.orEmpty(), a.name, a.role, a.roleNames(),
        if (a.role == Metadata.StaffAccess.STAFF) staffPermissions.permissions(a.id) else emptySet())

    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    fun pushEligible(id: UUID, version: Long): Boolean =
        accounts.lockedById(id)?.let {
            it.adminEnabled &&
                !it.mustChangePassword &&
                (it.role == Metadata.Identity.ADMIN ||
                    (it.role == Metadata.StaffAccess.STAFF && Metadata.StaffAccess.ENQUIRIES_VIEW in staffPermissions.permissions(it.id))) &&
                it.authVersion == version
        } == true

    fun access(id: UUID): AccountAccess? = accounts.findById(id).orElse(null)?.let(::accessView)

    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    fun lockAccess(id: UUID): AccountAccess? = accounts.lockedById(id)?.let(::accessView)

    private fun accessView(account: Account) =
        AccountAccess(
            account.id,
            account.email,
            account.role,
            account.verifiedAt,
            account.authVersion,
        )
}
