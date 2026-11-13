package ru.lastochka.payments.controller

import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import ru.lastochka.common.Metadata
import ru.lastochka.identity.entity.Account
import ru.lastochka.identity.service.LoginSessionService
import ru.lastochka.payments.alfa.AlfaConfigView
import ru.lastochka.payments.alfa.AlfaConfigurationService
import ru.lastochka.payments.alfa.AlfaGatewayEnvironment

class AlfaConfigurationControllerTest {
    @Test fun `view supplies the gateway mode with the existing configuration body`() {
        val service = mock(AlfaConfigurationService::class.java)
        val login = mock(LoginSessionService::class.java)
        val auth = UsernamePasswordAuthenticationToken.authenticated("fixture", null, emptyList())
        val account = Account(id = UUID.randomUUID(), email = "fixture@test.local", name = "Fixture", passwordHash = "x", role = Metadata.Identity.ADMIN)
        val body = AlfaConfigView(false, false, false, null, Instant.EPOCH, null)
        `when`(login.account(auth)).thenReturn(account)
        `when`(service.gatewayEnvironment()).thenReturn(AlfaGatewayEnvironment.TEST)
        `when`(service.view()).thenReturn(body)
        val response = AlfaConfigurationController(service, login).view(auth)
        assertEquals("TEST", response.headers.getFirst("X-Lastochka-Alfa-Environment"))
        assertEquals(body, response.body)
    }
}
