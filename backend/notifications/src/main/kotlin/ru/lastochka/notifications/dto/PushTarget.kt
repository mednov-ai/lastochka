package ru.lastochka.notifications.dto

import java.util.UUID

data class PushTarget(val id: UUID, val accountId: UUID, val authVersion: Long)
