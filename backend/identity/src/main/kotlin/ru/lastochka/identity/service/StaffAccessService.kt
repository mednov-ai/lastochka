package ru.lastochka.identity.service

import java.util.UUID
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.forbidden
import ru.lastochka.identity.entity.Account
import ru.lastochka.identity.repo.AccountRepository
import ru.lastochka.identity.repo.StaffPermissionRepository
import ru.lastochka.identity.security.StaffPermissionPolicy

@Service
class StaffAccessService(
    private val accounts: AccountRepository,
    private val permissions: StaffPermissionRepository,
) {
    @Transactional(readOnly = true)
    fun granted(a: Account): Set<String> =
        if (a.role == Metadata.Identity.ADMIN) Metadata.StaffAccess.ALL
        else permissions.permissions(a.id)

    @Transactional(readOnly = true)
    fun allows(a: Account, method: String, path: String): Boolean {
        if (!a.adminEnabled || a.mustChangePassword) return false
        if (a.role == Metadata.Identity.ADMIN) return true
        if (a.role != Metadata.StaffAccess.STAFF) return false
        val required = StaffPermissionPolicy.required(method, path) ?: return false
        return StaffPermissionPolicy.includes(permissions.permissions(a.id), required)
    }

    @Transactional(readOnly = true)
    fun requireEnquiryAccess(id: UUID) {
        val a = accounts.findById(id).orElse(null) ?: forbidden(Metadata.ErrorCodes.ACCESS_DENIED)
        if (!allows(a, Metadata.Identity.GET, Metadata.Concept.ADMIN_ENQUIRIES))
            forbidden(Metadata.ErrorCodes.ACCESS_DENIED)
    }
}
