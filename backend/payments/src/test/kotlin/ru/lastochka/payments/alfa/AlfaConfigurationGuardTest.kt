package ru.lastochka.payments.alfa

import java.time.Clock
import java.util.UUID
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.web.context.request.RequestContextHolder
import org.springframework.web.context.request.ServletRequestAttributes
import org.springframework.web.server.ResponseStatusException
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.unauthorized
import ru.lastochka.common.service.CommandService
import ru.lastochka.identity.service.LoginSessionService
import ru.lastochka.payments.repo.AlfaConfigurationRepository
import ru.lastochka.payments.repo.AlfaCredentialsRepository
import ru.lastochka.payments.repo.AlfaLinkRotationRepository
import ru.lastochka.payments.repo.AlfaTestAttemptQueries
import org.springframework.transaction.PlatformTransactionManager

class AlfaConfigurationGuardTest {
    @AfterEach fun clear() { RequestContextHolder.resetRequestAttributes(); SecurityContextHolder.clearContext() }

    @Test
    fun `expired password confirmation after acquiring the lock prevents configuration changes`() {
        val repo = mock(AlfaConfigurationRepository::class.java)
        val credentials = mock(AlfaCredentialsRepository::class.java)
        val links = mock(AlfaLinkRotationRepository::class.java)
        val commands = mock(CommandService::class.java)
        val login = mock(LoginSessionService::class.java)
        val service = AlfaConfigurationService(repo, credentials, links, mock(AlfaSecretBox::class.java), commands, login,
            mock(AlfaBankGateway::class.java), mock(AlfaTestAttemptQueries::class.java), Clock.systemUTC(),
            mock(PlatformTransactionManager::class.java), false, false, "")
        val request = MockHttpServletRequest()
        val auth = UsernamePasswordAuthenticationToken.authenticated("fixture", null, emptyList())
        RequestContextHolder.setRequestAttributes(ServletRequestAttributes(request))
        SecurityContextHolder.getContext().authentication = auth
        `when`(login.requireStage(request, auth)).thenAnswer { unauthorized(Metadata.ErrorCodes.REAUTH_REQUIRED) }
        val actor = UUID.randomUUID()
        assertThrows(ResponseStatusException::class.java) {
            service.candidate(actor, AlfaCandidateRequest("fixture", "fixture", true))
        }
        verify(commands).lockStudio()
        verify(login).requireStage(request, auth)
        verifyNoInteractions(repo, credentials, links)
    }
}
