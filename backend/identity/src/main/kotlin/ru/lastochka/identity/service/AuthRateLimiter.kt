package ru.lastochka.identity.service

import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.server.ResponseStatusException
import ru.lastochka.common.Metadata
import ru.lastochka.identity.config.IdentitySecurityProperties
import ru.lastochka.identity.repo.RateLimitRepository

@Service
class AuthRateLimiter(
    private val storage: RateLimitRepository,
    private val settings: IdentitySecurityProperties,
) {
    @Transactional(
        propagation = Propagation.REQUIRES_NEW,
        noRollbackFor = [ResponseStatusException::class],
    )
    fun check(bucket: String, limit: Int, seconds: Long? = null) {
        val window = seconds ?: settings.rateWindowSeconds
        val configuredLimit =
            when {
                bucket.startsWith(Metadata.Identity.RATE_LOGIN_IP_PREFIX) -> settings.loginIpLimit
                bucket.startsWith(Metadata.Identity.RATE_LOGIN_PREFIX) -> settings.loginAccountLimit
                else -> limit
            }
        val n = storage.increment(bucket, window)
        if (n > configuredLimit)
            throw ResponseStatusException(
                HttpStatus.TOO_MANY_REQUESTS,
                Metadata.ErrorCodes.RATE_LIMITED,
            )
    }
}
