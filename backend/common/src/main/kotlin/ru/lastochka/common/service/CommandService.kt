package ru.lastochka.common.service

import java.security.MessageDigest
import java.util.UUID
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.badRequest
import ru.lastochka.common.error.conflict
import ru.lastochka.common.repo.CommandRepository
import tools.jackson.databind.json.JsonMapper

@Service
class CommandService(
    private val storage: CommandRepository,
    private val json: JsonMapper,
    private val guards: List<CommandAccessGuard>,
) {
    @Transactional(propagation = Propagation.MANDATORY)
    fun lockStudio() {
        storage.lockStudio()
        guards.forEach { it.check() }
    }

    @Transactional
    fun <T : Any> execute(
        actor: UUID,
        operation: String,
        key: String,
        body: Any,
        type: Class<T>,
        action: () -> T,
    ): T {
        if (key.isBlank() || key.length > Metadata.Commands.MAX_KEY_LENGTH)
            badRequest(Metadata.ErrorCodes.INVALID_IDEMPOTENCY_KEY)
        lockStudio()
        val hash =
            MessageDigest.getInstance(Metadata.Protocol.SHA256)
                .digest(json.writeValueAsBytes(body))
                .joinToString("") {
                    "%02x".format(it)
                }
        val record = storage.findReplay(actor, operation, key)
        if (record != null) {
            if (record.requestHash != hash) conflict(Metadata.ErrorCodes.IDEMPOTENCY_CONFLICT)
            return json.readValue(record.response, type)
        }
        val result = action()
        storage.saveReplay(actor, operation, key, hash, json.writeValueAsString(result))
        return result
    }

    @Transactional(propagation = Propagation.MANDATORY)
    fun audit(
        id: UUID,
        actor: UUID?,
        action: String,
        before: Any?,
        after: Any?,
        reason: String? = null,
    ) {
        storage.appendAudit(
            id,
            actor,
            action,
            before?.let { json.writeValueAsString(it) },
            after?.let { json.writeValueAsString(it) },
            reason,
        )
    }
}
