package ru.lastochka.notifications.service

import java.math.BigInteger
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.URI
import java.net.UnknownHostException
import org.springframework.stereotype.Component
import ru.lastochka.common.Metadata

/** Validate both the URL and the addresses actually used by the HTTP client. */
@Component
class SafePushEndpoint {
    fun validate(value: String): URI {
        require(
            value.length in
                Metadata.BrowserPush.MIN_ENDPOINT_LENGTH..Metadata.BrowserPush.MAX_ENDPOINT_LENGTH
        )
        val uri = URI(value)
        val host = requireNotNull(uri.host).lowercase(java.util.Locale.ROOT)
        require(uri.scheme == "https" && uri.userInfo == null && uri.fragment == null)
        require(
            uri.port == Metadata.BrowserPush.DEFAULT_URI_PORT ||
                uri.port == Metadata.BrowserPush.HTTPS_PORT
        )
        require(
            host.length <= Metadata.BrowserPush.MAX_HOST_LENGTH &&
                host.contains('.') &&
                !host.endsWith('.')
        )
        require(
            host.matches(Regex(Metadata.BrowserPush.HOST_PATTERN)) && host.any { it in 'a'..'z' }
        )
        require(!host.endsWith(".localhost") && host != "localhost")
        resolve(host)
        return uri
    }

    fun resolve(host: String): Array<InetAddress> {
        val addresses = InetAddress.getAllByName(host)
        if (addresses.isEmpty() || addresses.any { !publicAddress(it) })
            throw UnknownHostException("Push service resolves to an unavailable address")
        return addresses
    }

    private fun belongs(address: InetAddress, cidr: String): Boolean {
        val parts = cidr.split('/')
        val base = InetAddress.getByName(parts.first()).address
        val target = address.address
        if (base.size != target.size) return false
        val shift = base.size * Metadata.BrowserPush.BITS_PER_BYTE - parts.last().toInt()
        return BigInteger(Metadata.BrowserPush.BIG_INTEGER_POSITIVE, base).shiftRight(shift) ==
            BigInteger(Metadata.BrowserPush.BIG_INTEGER_POSITIVE, target).shiftRight(shift)
    }

    fun publicAddress(address: InetAddress): Boolean {
        if (
            address.isAnyLocalAddress ||
                address.isLoopbackAddress ||
                address.isLinkLocalAddress ||
                address.isSiteLocalAddress ||
                address.isMulticastAddress
        )
            return false
        if (address is Inet6Address && !belongs(address, Metadata.BrowserPush.GLOBAL_IPV6))
            return false
        if (address !is Inet4Address && address !is Inet6Address) return false
        return Metadata.BrowserPush.RESTRICTED_RANGES.none { belongs(address, it) }
    }
}
