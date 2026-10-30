package ru.lastochka.identity.service

import java.util.UUID
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.*
import ru.lastochka.common.service.CommandService
import ru.lastochka.identity.repo.AdminAccessRepository

@Service
class AdminAccessService(
    private val storage: AdminAccessRepository,
    private val passwords: PasswordEncoder,
    private val commands: CommandService,
    private val lifecycle: PasswordLifecycleService,
    private val userPasswords: ru.lastochka.identity.repo.UserPasswordRepository,
) {
    @Transactional
    fun provision(id: UUID, value: String) {
        val login = value.trim().lowercase(java.util.Locale.ROOT)
        require(Regex(Metadata.Concept.LOGIN_PATTERN).matches(login))
        if (storage.provision(id, login) != 1) notFound(Metadata.ErrorCodes.NOT_FOUND)
    }

    @Transactional
    fun reset(id: UUID, password: String) {
        commands.lockStudio()
        val target = userPasswords.find(id) ?: notFound(Metadata.ErrorCodes.NOT_FOUND)
        if (target.role != Metadata.Identity.ADMIN) notFound(Metadata.ErrorCodes.NOT_FOUND)
        lifecycle.temporary(id, target.authVersion, password, null)
    }
}
