package ru.lastochka.identity.dto

import java.time.Instant
import java.util.UUID

data class AccountAccess(
    val id: UUID,
    val email: String,
    val role: String,
    val verifiedAt: Instant?,
    val authVersion: Long,
)
