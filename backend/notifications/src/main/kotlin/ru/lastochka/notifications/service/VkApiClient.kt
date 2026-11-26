package ru.lastochka.notifications.service

import java.io.IOException
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import org.springframework.beans.factory.annotation.Value
import org.springframework.core.env.Environment
import org.springframework.stereotype.Component
import ru.lastochka.common.Metadata
import ru.lastochka.notifications.dto.VkChat
import ru.lastochka.notifications.dto.VkSendResult
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

@Component
class VkApiClient(
    @Value(Metadata.Vk.API_URL) endpoint: String,
    private val json: JsonMapper,
    environment: Environment,
) {
    private val base = URI(endpoint)
    private val timeout = Duration.ofSeconds(Metadata.Concept.REQUEST_TIMEOUT_SECONDS)
    private val client = HttpClient.newBuilder().connectTimeout(timeout).build()

    init {
        require(
            base == URI("https://api.vk.com/method/") ||
                (environment.activeProfiles.any {
                    it.equals(Metadata.AlfaConnection.TEST_ENVIRONMENT, ignoreCase = true)
                } &&
                    base.scheme == "http" &&
                    base.host in setOf("localhost", "127.0.0.1") &&
                    endpoint.endsWith('/'))
        )
    }

    fun community(key: String): Long {
        val permissions = call("groups.getTokenPermissions", key)
        if (
            permissions.path("permissions").none { it.path("name").asString() == "messages" } &&
                permissions.path("mask").asLong() and Metadata.Vk.MESSAGE_PERMISSION == 0L
        )
            throw VkFailure(Metadata.Vk.BAD_KEY)
        val result = call("groups.getById", key)
        val groups = if (result.isArray) result else result.path("groups")
        return groups.path(0).path("id").asLong().takeIf { it > 0 }
            ?: throw VkFailure(Metadata.Vk.BAD_KEY)
    }

    fun conversations(key: String, groupId: Long): List<VkChat> {
        val chats = linkedMapOf<Long, VkChat>()
        for (page in 0 until Metadata.Vk.MAX_CHAT_PAGES) {
            val result =
                call(
                    "messages.getConversations",
                    key,
                    mapOf(
                        "group_id" to groupId,
                        "count" to Metadata.Vk.PAGE_SIZE,
                        "offset" to page * Metadata.Vk.PAGE_SIZE,
                    ),
                )
            val items = result.path("items")
            if (!items.isArray) throw VkFailure(Metadata.Vk.API_UNAVAILABLE, true)
            for (item in items) {
                val conversation = item.path("conversation")
                val peer = conversation.path("peer")
                val id = peer.path("id").asLong()
                val title = conversation.path("chat_settings").path("title").asString()
                if (
                    peer.path("type").asString() == "chat" &&
                        id > Metadata.Vk.GROUP_PEER_BASE &&
                        title.isNotBlank()
                )
                    chats[id] = VkChat(id, title)
            }
            if (
                items.size() < Metadata.Vk.PAGE_SIZE ||
                    (page + 1) * Metadata.Vk.PAGE_SIZE >= result.path("count").asInt(Int.MAX_VALUE)
            )
                break
        }
        return chats.values.toList()
    }

    fun conversation(key: String, groupId: Long, peer: Long): VkChat? {
        val result = call("messages.getConversationsById", key, mapOf("group_id" to groupId, "peer_ids" to peer))
        return result.path("items").firstNotNullOfOrNull { item ->
            val address = item.path("peer")
            val title = item.path("chat_settings").path("title").asString()
            if (address.path("type").asString() == "chat" && address.path("id").asLong() == peer && title.isNotBlank())
                VkChat(peer, title)
            else null
        }
    }

    fun send(key: String, chat: Long, randomId: Int, body: String): VkSendResult =
        try {
            val response =
                call(
                    "messages.send",
                    key,
                    mapOf(
                        "peer_ids" to chat,
                        "random_id" to randomId,
                        "message" to body,
                        "dont_parse_links" to 1,
                        "disable_mentions" to 1,
                    ),
                )
            val recipient =
                response.singleOrNull { it.path("peer_id").asLong() == chat }
                    ?: throw VkFailure(Metadata.Vk.API_UNAVAILABLE, true)
            val error = recipient.path("error")
            // With peer_ids VK reports a recipient error as {code, description}.
            if (!error.isMissingNode && !error.isNull) throw apiError(error.path("code").asInt())
            val id =
                recipient.path("conversation_message_id").asLong().takeIf { it > 0 }
                    ?: recipient.path("message_id").asLong().takeIf { it > 0 }
                    ?: throw VkFailure(Metadata.Vk.API_UNAVAILABLE, true)
            VkSendResult(messageId = id)
        } catch (error: VkFailure) {
            VkSendResult(error = error.code, temporary = error.temporary)
        }

    private fun call(method: String, key: String, params: Map<String, Any> = emptyMap()): JsonNode {
        val form =
            (params + mapOf("access_token" to key, "v" to Metadata.Vk.API_VERSION))
                .entries
                .joinToString("&") {
                    "${it.key}=${URLEncoder.encode(it.value.toString(), Charsets.UTF_8)}"
                }
        val request =
            HttpRequest.newBuilder(base.resolve(method))
                .timeout(timeout)
                .header(Metadata.Protocol.CONTENT_TYPE, "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(form))
                .build()
        val response =
            try {
                client.send(request, HttpResponse.BodyHandlers.ofString())
            } catch (_: IOException) {
                throw VkFailure(Metadata.Vk.API_UNAVAILABLE, true)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                throw VkFailure(Metadata.Vk.API_UNAVAILABLE, true)
            }
        if (response.statusCode() == Metadata.Http.TOO_MANY_REQUESTS)
            throw VkFailure(Metadata.Vk.LIMITED, true)
        if (response.statusCode() !in Metadata.Concept.HTTP_SUCCESS)
            throw VkFailure(Metadata.Vk.API_UNAVAILABLE, true)
        val payload =
            try {
                json.readTree(response.body())
            } catch (_: RuntimeException) {
                throw VkFailure(Metadata.Vk.API_UNAVAILABLE, true)
            }
        val error = payload.path("error")
        if (!error.isMissingNode && !error.isNull) throw apiError(error.path("error_code").asInt())
        return payload.path("response").takeUnless { it.isMissingNode || it.isNull }
            ?: throw VkFailure(Metadata.Vk.API_UNAVAILABLE, true)
    }

    private fun apiError(code: Int) =
        when (code) {
            Metadata.Vk.API_TOO_MANY_REQUESTS,
            Metadata.Vk.API_FLOOD_CONTROL,
            Metadata.Vk.API_RATE_LIMIT -> VkFailure(Metadata.Vk.LIMITED, true)
            Metadata.Vk.API_UNKNOWN_ERROR,
            Metadata.Vk.API_INTERNAL_ERROR -> VkFailure(Metadata.Vk.API_UNAVAILABLE, true)
            Metadata.Vk.API_AUTH_ERROR,
            Metadata.Vk.API_GROUP_AUTH_ERROR -> VkFailure(Metadata.Vk.BAD_KEY)
            Metadata.Vk.API_PERMISSION_DENIED,
            Metadata.Vk.API_MESSAGES_DENIED,
            Metadata.Vk.API_CHAT_NO_ACCESS,
            Metadata.Vk.API_CHAT_NOT_ADMIN,
            Metadata.Vk.API_CONTACT_NOT_FOUND -> VkFailure(Metadata.Vk.CHAT_UNAVAILABLE)
            else -> VkFailure(Metadata.Vk.REJECTED)
        }
}

class VkFailure(val code: String, val temporary: Boolean = false) : RuntimeException(code)
