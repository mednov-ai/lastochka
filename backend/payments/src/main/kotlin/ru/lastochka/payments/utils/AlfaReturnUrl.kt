package ru.lastochka.payments.utils

import java.net.URI
import ru.lastochka.common.Metadata

/** Only the configured public origin and the fixed test return route may go to the bank. */
object AlfaReturnUrl {
    fun allowed(candidate: String, publicOrigin: String): Boolean = runCatching {
        val target = URI(candidate)
        val origin = URI(publicOrigin)
        fun port(uri: URI): Int = if (uri.port == -1) Metadata.AlfaConnection.HTTPS_PORT else uri.port
        fun validOrigin(uri: URI): Boolean =
            uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrBlank() &&
                uri.userInfo == null && uri.rawQuery == null && uri.rawFragment == null &&
                (uri.port == -1 || uri.port in 1..Metadata.AlfaPayment.MAX_PORT)
        validOrigin(target) && validOrigin(origin) &&
            (origin.rawPath.isNullOrEmpty()) &&
            target.host.equals(origin.host, ignoreCase = true) && port(target) == port(origin) &&
            target.rawPath in setOf(Metadata.AlfaPayment.RETURN_PATH, Metadata.AlfaPayment.ROOT_RETURN_PATH)
    }.getOrDefault(false)
}
