package ru.lastochka.enquiries.controller

import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RestController
import ru.lastochka.common.Metadata
import ru.lastochka.notifications.service.VkChatLinkService
import tools.jackson.core.JacksonException
import tools.jackson.databind.json.JsonMapper

@RestController
class VkChatCallbackController(private val links: VkChatLinkService, private val json: JsonMapper) {
    @PostMapping(Metadata.Vk.CALLBACK, produces = [MediaType.TEXT_PLAIN_VALUE])
    fun event(request: HttpServletRequest): ResponseEntity<String> {
        val bytes = request.inputStream.readNBytes(Metadata.Vk.CALLBACK_MAX_BYTES + 1)
        if (bytes.size > Metadata.Vk.CALLBACK_MAX_BYTES) return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).build()
        val event = try {
            json.readTree(bytes)
        } catch (_: JacksonException) {
            return ResponseEntity.badRequest().build()
        }
        val reply = links.receive(event) ?: return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        return ResponseEntity.ok(reply)
    }
}
