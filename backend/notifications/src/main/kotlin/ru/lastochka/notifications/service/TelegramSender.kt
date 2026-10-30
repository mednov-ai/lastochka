package ru.lastochka.notifications.service

import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import org.springframework.core.env.Environment
import org.springframework.stereotype.Service
import ru.lastochka.common.Metadata
import ru.lastochka.notifications.config.TelegramProperties
import ru.lastochka.notifications.dto.TelegramResult
import tools.jackson.databind.json.JsonMapper

@Service
class TelegramSender(
    private val settings: TelegramProperties,
    private val json: JsonMapper,
    env: Environment,
) {
    private val client =
        HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(Metadata.Concept.REQUEST_TIMEOUT_SECONDS))
            .build()

    init {
        val uri = URI(settings.apiUrl)
        require(
            settings.apiUrl == Metadata.Concept.TELEGRAM_URL ||
                (env.activeProfiles.contains("test") && uri.host in setOf("127.0.0.1", "localhost"))
        ) {
            "Telegram endpoint is not allowed"
        }
    }

    fun configured() = settings.token.isNotBlank() && settings.chatId.isNotBlank()

    fun send(body: String): TelegramResult {
        require(body.length <= Metadata.Concept.TELEGRAM_MESSAGE_LIMIT)
        val request =
            HttpRequest.newBuilder(URI(settings.apiUrl + "/bot" + settings.token + "/sendMessage"))
                .timeout(Duration.ofSeconds(Metadata.Concept.REQUEST_TIMEOUT_SECONDS))
                .header(Metadata.Protocol.CONTENT_TYPE, Metadata.Protocol.JSON)
                .POST(
                    HttpRequest.BodyPublishers.ofString(
                        json.writeValueAsString(
                            mapOf(
                                "chat_id" to settings.chatId,
                                "text" to body,
                                "link_preview_options" to mapOf("is_disabled" to true),
                            )
                        )
                    )
                )
                .build()
        val response = client.send(request, HttpResponse.BodyHandlers.ofString())
        val result = json.readTree(response.body())
        if (
            response.statusCode() in Metadata.Concept.HTTP_SUCCESS && result.path("ok").asBoolean()
        ) {
            val id = result.path("result").path("message_id").asLong()
            if (id > 0) return TelegramResult(messageId = id)
        }
        val code = result.path("error_code").asInt(response.statusCode())
        return TelegramResult(
            retrySeconds =
                result.path("parameters").path("retry_after").asLong(0).takeIf { it > 0 },
            permanent =
                code in Metadata.Concept.HTTP_PERMANENT && code != Metadata.Http.TOO_MANY_REQUESTS,
            chatMigrated = result.path("parameters").path("migrate_to_chat_id").asLong(0) != 0L,
        )
    }
}
