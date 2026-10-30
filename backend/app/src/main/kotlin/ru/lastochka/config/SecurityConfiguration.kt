package ru.lastochka.config

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.security.authorization.AuthorizationDecision
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.context.HttpSessionSecurityContextRepository
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler
import ru.lastochka.common.Metadata
import ru.lastochka.identity.service.AccountService
import tools.jackson.databind.json.JsonMapper

@Configuration
class SecurityConfiguration {
    @Bean
    fun security(
        http: HttpSecurity,
        json: JsonMapper,
        accounts: AccountService,
        clock: java.time.Clock,
        apiErrors: ru.lastochka.common.error.ApiErrorFactory,
        @org.springframework.beans.factory.annotation.Value(Metadata.Concept.ACCESS_GENERATION)
        generation: String,
        @org.springframework.beans.factory.annotation.Value(Metadata.Configuration.LASTOCHKA_ORIGIN)
        origin: String,
    ): SecurityFilterChain {
        http.addFilterBefore(
            EnquiryRequestFilter(json, apiErrors, origin),
            org.springframework.security.web.access.intercept.AuthorizationFilter::class.java,
        )
        http.addFilterBefore(
            LegacyEndpointFilter(json, apiErrors),
            org.springframework.security.web.access.intercept.AuthorizationFilter::class.java,
        )
        http.addFilterBefore(
            ru.lastochka.identity.security.SessionVersionFilter(
                accounts,
                generation,
                clock,
                json,
                apiErrors,
            ),
            org.springframework.security.web.access.intercept.AuthorizationFilter::class.java,
        )
        fun verifiedPassword(auth: org.springframework.security.core.Authentication): Boolean =
            auth.authorities.any { it.authority == Metadata.Identity.FACTOR_PASSWORD } &&
                accounts.isVerified(auth.name)
        http.securityContext {
            it.securityContextRepository(HttpSessionSecurityContextRepository())
        }
        http.csrf {
            it.csrfTokenRequestHandler(CsrfTokenRequestAttributeHandler())
        }
        http.authorizeHttpRequests { rules ->
            rules
                .requestMatchers(
                    Metadata.Concept.PUBLIC_ENQUIRIES,
                    Metadata.Routes.API_V1_PUBLIC_ANY,
                    Metadata.Routes.API_V1_SESSIONS_ANY,
                    Metadata.Routes.ACTUATOR_HEALTH_ANY,
                    Metadata.Routes.V3_API_DOCS_ANY,
                    Metadata.Routes.SWAGGER_UI_ANY,
                    Metadata.Routes.SWAGGER_UI_HTML,
                    Metadata.Routes.ERROR,
                )
                .permitAll()
            rules.requestMatchers(Metadata.Routes.API_V1_AUTH_WEBAUTHN_ANY).authenticated()
            rules.requestMatchers(Metadata.Routes.API_V1_AUTH_ANY).permitAll()
            rules.requestMatchers(Metadata.Routes.API_V1_ADMIN_ANY).access { auth, _ ->
                val roles = auth.get().authorities.map { it.authority }.toSet()
                AuthorizationDecision(
                    verifiedPassword(auth.get()) && Metadata.Identity.ROLE_ADMIN in roles
                )
            }
            rules.requestMatchers(Metadata.Routes.API_V1_ANY).access { auth, _ ->
                AuthorizationDecision(verifiedPassword(auth.get()))
            }
            rules.anyRequest().denyAll()
        }
        http.exceptionHandling { errors ->
            errors.authenticationEntryPoint { _, res, _ ->
                res.status = Metadata.Http.UNAUTHORIZED
                res.contentType = Metadata.Protocol.PROBLEM_JSON
                json.writeValue(
                    res.outputStream,
                    apiErrors.body(Metadata.Http.UNAUTHORIZED, Metadata.ErrorCodes.AUTH_REQUIRED),
                )
            }
            errors.accessDeniedHandler { _, res, _ ->
                res.status = Metadata.Http.FORBIDDEN
                res.contentType = Metadata.Protocol.PROBLEM_JSON
                json.writeValue(
                    res.outputStream,
                    apiErrors.body(Metadata.Http.FORBIDDEN, Metadata.ErrorCodes.ACCESS_DENIED),
                )
            }
        }
        return http.build()
    }
}
