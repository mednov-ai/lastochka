package ru.lastochka.notifications.dto

import java.time.Instant

data class VkLinkCode(val code: String, val expiresAt: Instant)
