package ru.lastochka.integration

import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.security.core.context.SecurityContextHolder
import ru.lastochka.common.Metadata
import ru.lastochka.identity.entity.Account
import ru.lastochka.identity.service.AccountService
import ru.lastochka.identity.service.LoginSessionService

class PasswordConfirmationUnitTest {
    @AfterEach fun clear() { SecurityContextHolder.clearContext() }

    @Test fun `key confirmation does not extend last password time`() {
        val now = Instant.parse("2026-11-12T12:00:00Z")
        val service = LoginSessionService(mock(AccountService::class.java), Clock.fixed(now, ZoneOffset.UTC), "fixture")
        val request = MockHttpServletRequest()
        val initial = now.minusSeconds(299).toString()
        request.session.setAttribute(Metadata.Identity.PASSWORD_AT_ATTRIBUTE, initial)
        val account = Account(email = "fixture", name = "Тест", passwordHash = "hash", role = "ADMIN", login = "fixture", adminEnabled = true)
        service.save(account, true, request, MockHttpServletResponse())
        assertEquals(initial, request.session.getAttribute(Metadata.Identity.PASSWORD_AT_ATTRIBUTE))
    }
}
