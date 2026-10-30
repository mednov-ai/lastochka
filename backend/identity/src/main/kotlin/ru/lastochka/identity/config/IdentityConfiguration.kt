package ru.lastochka.identity.config

import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.jdbc.core.JdbcOperations
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.security.web.webauthn.api.*
import org.springframework.security.web.webauthn.jackson.WebauthnJacksonModule
import org.springframework.security.web.webauthn.management.*
import ru.lastochka.common.Metadata
import ru.lastochka.identity.service.AccountService

@Configuration
@org.springframework.boot.context.properties.EnableConfigurationProperties(
    IdentitySecurityProperties::class
)
class IdentityConfiguration {
    @Bean
    fun userDetailsService(accounts: AccountService) =
        org.springframework.security.core.userdetails.UserDetailsService { email ->
            val account =
                accounts.find(email)
                    ?: throw org.springframework.security.core.userdetails
                        .UsernameNotFoundException("Account unavailable")
            org.springframework.security.core.userdetails.User.withUsername(account.email)
                .password(account.passwordHash)
                .roles(*account.roleNames().toTypedArray())
                .build()
        }

    @Bean fun passwords(): PasswordEncoder = Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8()

    @Bean fun users(jdbc: JdbcOperations) = JdbcPublicKeyCredentialUserEntityRepository(jdbc)

    @Bean fun credentials(jdbc: JdbcOperations) = JdbcUserCredentialRepository(jdbc)

    @Bean fun webauthnModule() = WebauthnJacksonModule()

    @Bean
    fun relyingParty(
        users: JdbcPublicKeyCredentialUserEntityRepository,
        credentials: JdbcUserCredentialRepository,
        @Value(Metadata.Configuration.LASTOCHKA_RP_ID) rpId: String,
        @Value(Metadata.Configuration.LASTOCHKA_ORIGIN) origin: String,
    ): WebAuthnRelyingPartyOperations =
        Webauthn4JRelyingPartyOperations(
                users,
                credentials,
                PublicKeyCredentialRpEntity.builder().id(rpId).name("Ласточка").build(),
                setOf(origin),
            )
            .apply {
                setCustomizeCreationOptions {
                    it.authenticatorSelection(
                        AuthenticatorSelectionCriteria.builder()
                            .residentKey(ResidentKeyRequirement.REQUIRED)
                            .userVerification(UserVerificationRequirement.REQUIRED)
                            .build()
                    )
                }
                setCustomizeRequestOptions {
                    it.userVerification(UserVerificationRequirement.REQUIRED)
                }
            }
}
