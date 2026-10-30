package ru.lastochka.identity.dto

import io.swagger.v3.oas.annotations.media.Schema
import jakarta.validation.constraints.*
import java.util.UUID
import ru.lastochka.common.Metadata

data class PasswordRequest(
    @field:NotBlank
    @field:Size(max = Metadata.Concept.LOGIN_MAX)
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val login: String,
    @field:ru.lastochka.identity.validation.PasswordValue(newValue = false)
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val password: String,
)

data class AccountView(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val id: UUID,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val login: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val name: String,
    @field:Schema(
        requiredMode = Schema.RequiredMode.REQUIRED,
        allowableValues = [Metadata.Identity.ADMIN],
    )
    val role: String,
    @field:Schema(
        requiredMode = Schema.RequiredMode.REQUIRED,
        description = "Единственная роль ADMIN",
    )
    val roles: List<String> = listOf(role),
)

data class AuthView(
    @field:Schema(
        requiredMode = Schema.RequiredMode.REQUIRED,
        allowableValues =
            [
                Metadata.Identity.ANONYMOUS,
                Metadata.Identity.FULL,
                Metadata.PasswordLifecycle.REQUIRED,
            ],
    )
    val state: String,
    @field:Schema(nullable = true) val account: AccountView?,
)

data class CredentialView(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val id: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val label: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val createdAt: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val lastUsedAt: String,
)

data class CredentialLabelRequest(
    @field:NotBlank
    @field:Size(max = Metadata.Limits.MAX_NAME_LENGTH)
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val label: String
)

data class CsrfResponse(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val headerName: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val parameterName: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val token: String,
)
