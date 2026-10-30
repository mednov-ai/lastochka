package ru.lastochka.identity.dto

import io.swagger.v3.oas.annotations.media.Schema
import jakarta.validation.constraints.*
import org.springframework.security.web.webauthn.api.*
import ru.lastochka.common.Metadata

data class RegisterCredentialRequest(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val credential: PublicKeyCredential<AuthenticatorAttestationResponse>,
    @field:NotBlank
    @field:Size(max = Metadata.Limits.MAX_NAME_LENGTH)
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val label: String,
)

data class AuthenticateCredentialRequest(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val credential: PublicKeyCredential<AuthenticatorAssertionResponse>
)
