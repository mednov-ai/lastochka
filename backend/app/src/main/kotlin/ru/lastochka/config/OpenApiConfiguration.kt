package ru.lastochka.config

import io.swagger.v3.core.converter.ModelConverters
import io.swagger.v3.oas.models.Components
import io.swagger.v3.oas.models.OpenAPI
import io.swagger.v3.oas.models.info.Info
import io.swagger.v3.oas.models.media.Content
import io.swagger.v3.oas.models.media.MediaType
import io.swagger.v3.oas.models.media.Schema
import io.swagger.v3.oas.models.responses.ApiResponse
import io.swagger.v3.oas.models.servers.Server
import org.springdoc.core.customizers.OperationCustomizer
import org.springdoc.core.utils.SpringDocUtils
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.security.web.webauthn.api.*
import ru.lastochka.common.Metadata
import ru.lastochka.common.dto.ApiError
import ru.lastochka.identity.security.StaffPermissionPolicy

@Configuration
class OpenApiConfiguration {
    init {
        val config = SpringDocUtils.getConfig()
        config.replaceWithSchema(
            Bytes::class.java,
            Schema<String>().type("string").format("base64url"),
        )
        config.replaceWithSchema(
            java.time.Duration::class.java,
            Schema<Long>().type("integer").format("int64").description("Миллисекунды"),
        )
        listOf(
                UserVerificationRequirement::class.java,
                ResidentKeyRequirement::class.java,
                PublicKeyCredentialType::class.java,
                AuthenticatorTransport::class.java,
                AuthenticatorAttachment::class.java,
                AttestationConveyancePreference::class.java,
            )
            .forEach { type ->
                val values =
                    type.fields
                        .filter { it.type == type }
                        .map { type.getMethod("getValue").invoke(it.get(null)).toString() }
                        .sorted()
                config.replaceWithSchema(type, Schema<String>().type("string")._enum(values))
            }
        val algorithms =
            COSEAlgorithmIdentifier::class
                .java
                .fields
                .filter { it.type == COSEAlgorithmIdentifier::class.java }
                .map {
                    (COSEAlgorithmIdentifier::class.java.getMethod("getValue").invoke(it.get(null))
                            as Number)
                        .toLong()
                }
                .sorted()
        config.replaceWithSchema(
            COSEAlgorithmIdentifier::class.java,
            Schema<Long>().type("integer").format("int64")._enum(algorithms),
        )
    }

    @Bean
    fun openApi() =
        OpenAPI()
            .info(Info().title("Ласточка API").version("0.1.0"))
            .servers(listOf(Server().url(Metadata.Routes.LASTOCHKA)))
            .components(
                Components()
                    .schemas(ModelConverters.getInstance().read(ApiError::class.java))
                    .addSecuritySchemes(
                        "session",
                        io.swagger.v3.oas.models.security
                            .SecurityScheme()
                            .type(io.swagger.v3.oas.models.security.SecurityScheme.Type.APIKEY)
                            .`in`(io.swagger.v3.oas.models.security.SecurityScheme.In.COOKIE)
                            .name(Metadata.Protocol.LASTOCHKA_SESSION),
                    )
                    .addSecuritySchemes(
                        "csrf",
                        io.swagger.v3.oas.models.security
                            .SecurityScheme()
                            .type(io.swagger.v3.oas.models.security.SecurityScheme.Type.APIKEY)
                            .`in`(io.swagger.v3.oas.models.security.SecurityScheme.In.HEADER)
                            .name(Metadata.Protocol.CSRF_HEADER),
                    )
            )

    @Bean
    fun authenticationContract() =
        org.springdoc.core.customizers.OpenApiCustomizer { doc ->
            val required =
                mapOf(
                    "PublicKeyCredentialCreationOptions" to
                        listOf(
                            "rp",
                            "user",
                            "challenge",
                            "pubKeyCredParams",
                            "authenticatorSelection",
                        ),
                    "PublicKeyCredentialRequestOptions" to
                        listOf("challenge", "rpId", "allowCredentials", "userVerification"),
                    "PublicKeyCredentialUserEntity" to listOf("id", "name", "displayName"),
                    "PublicKeyCredentialRpEntity" to listOf("id", "name"),
                    "PublicKeyCredentialDescriptor" to listOf("id", "type"),
                    "PublicKeyCredentialParameters" to listOf("type", "alg"),
                )
            required.forEach { (name, fields) -> doc.components.schemas[name]?.required = fields }
            doc.paths.forEach { (path, item) ->
                item.readOperationsMap().forEach { (method, operation) ->
                    val public =
                        path == Metadata.Concept.PUBLIC_ENQUIRIES ||
                            path.startsWith(Metadata.Routes.API_V1_PUBLIC) ||
                            path.startsWith(Metadata.Routes.API_V1_SESSIONS) ||
                            path.startsWith(Metadata.Routes.API_V1_AUTH) &&
                                !path.startsWith(Metadata.Routes.API_V1_AUTH_WEBAUTHN)
                    val security = io.swagger.v3.oas.models.security.SecurityRequirement()
                    if (!public) security.addList("session")
                    if (
                        method in
                            listOf(
                                io.swagger.v3.oas.models.PathItem.HttpMethod.POST,
                                io.swagger.v3.oas.models.PathItem.HttpMethod.PUT,
                                io.swagger.v3.oas.models.PathItem.HttpMethod.PATCH,
                                io.swagger.v3.oas.models.PathItem.HttpMethod.DELETE,
                            )
                    )
                        security.addList("csrf")
                    if (security.isNotEmpty()) operation.security = listOf(security)
                    operation.description =
                        when {
                            path == Metadata.Concept.PUBLIC_ENQUIRIES ->
                                "Гостевая заявка без аккаунта и брони. Требуются CSRF, свой Origin и Idempotency-Key; ответ содержит только номер и время."
                            path.startsWith(Metadata.Routes.API_V1_AUTH_WEBAUTHN) ->
                                "Добровольные собственные ключи допущенного пользователя. Недавний парольный вход до 5 минут, проверка origin/RP и одноразового challenge. Бинарные поля base64url."
                            path.startsWith(Metadata.Recurrence.GROUPS) ||
                                path.startsWith(Metadata.Recurrence.SERIES) ->
                                "Полная сессия допущенного пользователя и соответствующее право расписания; ограниченная сессия смены пароля недопустима. Команды требуют CSRF, Idempotency-Key и актуальные версии. Повтор с иным содержимым даёт 409. Еженедельные дни ISO 1–7, даты включительно в Europe/Moscow; не более 366 дней и 200 дат, полный предпросмотр. Публикация атомарна и повторно проверяет ресурсы и версии; старые и разовые исключения сохраняются."
                            path.startsWith(Metadata.Editor.ROOT) ->
                                "Полная сессия допущенного пользователя и соответствующее право расписания; команды требуют CSRF, Idempotency-Key и актуальные версии. Индивидуальная правка неотменённого занятия допустима после начала с проверкой интервала и ресурсов; отменённое занятие доступно для просмотра и истории. Отмена и изменение приёма после начала запрещены. Снимки прежних заявок сохраняются."
                            !public ->
                                "Полная сессия допущенного пользователя и соответствующее право. Изменения требуют CSRF и актуальную версию, если она предусмотрена контрактом."
                            else ->
                                "Публичная операция. Изменения требуют CSRF из /api/v1/auth/csrf."
                        }
                    if (path.startsWith("/api/v1/admin/")) {
                        val permission = StaffPermissionPolicy.required(method.name, path)
                        val rule = when (permission) {
                            Metadata.StaffAccess.SCHEDULE_VIEW -> "Просмотр расписания"
                            Metadata.StaffAccess.SCHEDULE_EDIT -> "Изменение расписания"
                            Metadata.StaffAccess.PAYMENT_VIEW -> "Просмотр оплат"
                            Metadata.StaffAccess.PAYMENT_EDIT -> "Изменение оплат"
                            Metadata.StaffAccess.ENQUIRIES_VIEW -> "Заявки"
                            Metadata.StaffAccess.SELF -> "Собственное устройство"
                            else -> "Только администратор"
                        }
                        operation.description += " Доступ: $rule; администратор имеет полный доступ."
                    }
                }
            }
        }

    @Bean
    fun errors() = OperationCustomizer { operation, _ ->
        listOf(
                Metadata.Http.BAD_REQUEST,
                Metadata.Http.UNAUTHORIZED,
                Metadata.Http.FORBIDDEN,
                Metadata.Http.NOT_FOUND,
                Metadata.Http.METHOD_NOT_ALLOWED,
                Metadata.Http.CONFLICT,
                Metadata.Http.TOO_MANY_REQUESTS,
                Metadata.Http.INTERNAL_ERROR,
                Metadata.Http.UNAVAILABLE,
            )
            .forEach { code ->
                operation.responses.addApiResponse(
                    code.toString(),
                    ApiResponse()
                        .description("Ошибка запроса $code")
                        .content(
                            Content()
                                .addMediaType(
                                    Metadata.Protocol.PROBLEM_JSON,
                                    MediaType()
                                        .schema(
                                            Schema<ApiError>()
                                                .`$ref`("#/components/schemas/ApiError")
                                        ),
                                )
                        ),
                )
            }
        operation
    }
}
