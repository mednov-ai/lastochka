package ru.lastochka.identity.config

import org.springframework.boot.context.properties.ConfigurationProperties
import ru.lastochka.common.Metadata

@ConfigurationProperties(Metadata.Configuration.SECURITY_PREFIX)
data class IdentitySecurityProperties(
    val loginIpLimit: Int = Metadata.IdentityLimits.LOGIN_IP,
    val loginAccountLimit: Int = Metadata.IdentityLimits.LOGIN_ACCOUNT,
    val rateWindowSeconds: Long = Metadata.IdentityLimits.RATE_WINDOW_SECONDS,
) {
    init {
        require(listOf(loginIpLimit, loginAccountLimit).all { it > 0 })
        require(rateWindowSeconds in 1..Metadata.IdentityLimits.MAX_RATE_WINDOW_SECONDS)
    }
}
