package ru.lastochka.payments.service

import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.time.Clock
import java.util.Base64
import java.util.HexFormat
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.payments.alfa.AlfaConfigurationService
import ru.lastochka.payments.repo.AlfaTestAttemptQueries

/** Bank GET callback: the query string and signature must never be logged. */
@Service
class AlfaCallbackService(
    private val attempts: AlfaTestAttemptQueries,
    private val config: AlfaConfigurationService,
    private val clock: Clock,
    @Value(Metadata.AlfaPayment.CALLBACK_SETTING) private val confirmed: Boolean,
    @Value(Metadata.AlfaPayment.CALLBACK_SECRET_SETTING) private val secretFile: String,
) {
    private var windowMinute = Long.MIN_VALUE
    private var windowRequests = 0

    @Synchronized
    private fun withinLimit(): Boolean {
        val minute = clock.instant().epochSecond / Metadata.AlfaPayment.SECONDS_PER_MINUTE
        if (minute != windowMinute) { windowMinute = minute; windowRequests = 0 }
        windowRequests += 1
        return windowRequests <= Metadata.AlfaPayment.CALLBACK_MAX_REQUESTS
    }

    @Transactional
    fun accept(params: Map<String, List<String>>): Boolean {
        if (!confirmed || secretFile.isBlank() || !withinLimit()) return false
        if (params.size !in Metadata.AlfaPayment.CALLBACK_MIN_PARAMS..Metadata.AlfaPayment.CALLBACK_MAX_PARAMS || params.values.any { it.size != 1 } ||
            params.entries.sumOf { it.key.length + it.value.first().length } > Metadata.AlfaPayment.CALLBACK_MAX_LENGTH) return false
        if (params.keys.any { !it.matches(Regex(Metadata.AlfaPayment.PARAM_NAME_PATTERN)) } ||
            params.values.flatten().any { value -> value.length > Metadata.AlfaPayment.CALLBACK_MAX_VALUE || value.any { it == ';' || it.isISOControl() } }) return false
        val checksum = params["checksum"]?.singleOrNull() ?: return false
        if (!checksum.matches(Regex(Metadata.AlfaPayment.CHECKSUM_PATTERN))) return false
        if (runCatching { config.activeVersion() }.getOrNull() == null) return false
        val key = try {
            val file = Path.of(secretFile)
            require(Files.isRegularFile(file) && Files.size(file) in 1..Metadata.AlfaPayment.SECRET_MAX_BYTES)
            Base64.getDecoder().decode(Files.readString(file).trim()).also { require(it.size in Metadata.AlfaPayment.KEY_MIN_BYTES..Metadata.AlfaPayment.KEY_MAX_BYTES) }
        } catch (_: Exception) { return false }
        val supplied = HexFormat.of().parseHex(checksum)
        val expected = try { checksum(params.mapValues { it.value.single() }, key) }
        finally { key.fill(0) }
        if (!MessageDigest.isEqual(supplied, expected)) return false
        val orderNumber = params["orderNumber"]?.singleOrNull() ?: return false
        val orderId = params["mdOrder"]?.singleOrNull() ?: return false
        if (params["operation"]?.singleOrNull().isNullOrBlank() || params["status"]?.singleOrNull() !in setOf("0", "1")) return false
        val row = attempts.findByOrderNumber(orderNumber) ?: return false
        if (row.environment != Metadata.AlfaConnection.TEST_ENVIRONMENT) return false
        if (row.orderId != null && row.orderId != orderId) return false
        val digest = HexFormat.of().formatHex(MessageDigest.getInstance(Metadata.Protocol.SHA256).digest(supplied))
        if (attempts.acceptCallback(digest, row.paymentId) == 1) attempts.scheduleCallback(row.paymentId, clock.instant())
        return true
    }

    companion object {
        /** Names are sorted exactly as in the bank's callback guide, including trailing semicolon. */
        fun checksum(params: Map<String, String>, key: ByteArray): ByteArray {
            val content = params.filterKeys { it != "checksum" }.toSortedMap().entries
                .joinToString("") { "${it.key};${it.value};" }
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(key, "HmacSHA256"))
            return mac.doFinal(content.toByteArray(StandardCharsets.UTF_8))
        }
    }
}
