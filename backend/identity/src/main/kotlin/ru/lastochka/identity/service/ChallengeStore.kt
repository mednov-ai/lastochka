package ru.lastochka.identity.service

import java.time.Clock
import java.util.UUID
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.server.ResponseStatusException
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.badRequest
import ru.lastochka.identity.repo.ChallengeRepository

@Service
class ChallengeStore(
    private val storage: ChallengeRepository,
    private val clock: Clock,
) {
    @Transactional
    fun save(sessionId: String, accountId: UUID, kind: String, payload: String) {
        storage.save(sessionId, accountId, kind, payload)
    }

    @Transactional(
        propagation = Propagation.REQUIRES_NEW,
        noRollbackFor = [ResponseStatusException::class],
    )
    fun consume(sessionId: String, accountId: UUID, kind: String): String {
        val row = storage.consume(sessionId) ?: badRequest(Metadata.ErrorCodes.INVALID_CHALLENGE)
        if (row.accountId != accountId || row.kind != kind || row.expiresAt <= clock.instant())
            badRequest(Metadata.ErrorCodes.INVALID_CHALLENGE)
        return row.payload
    }
}
