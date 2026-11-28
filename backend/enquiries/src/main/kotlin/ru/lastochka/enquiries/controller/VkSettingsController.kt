package ru.lastochka.enquiries.controller

import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import ru.lastochka.common.Metadata
import ru.lastochka.identity.service.AuthRateLimiter
import ru.lastochka.identity.service.LoginSessionService
import ru.lastochka.notifications.dto.VkChatInput
import ru.lastochka.notifications.dto.VkCallbackSetupInput
import ru.lastochka.notifications.dto.VkKeyInput
import ru.lastochka.notifications.dto.VkToggleInput
import ru.lastochka.notifications.dto.VkVersionInput
import ru.lastochka.notifications.service.VkChatLinkService
import ru.lastochka.notifications.service.VkSettingsService

@RestController
@RequestMapping(Metadata.Vk.SETTINGS)
class VkSettingsController(
    private val settings: VkSettingsService,
    private val links: VkChatLinkService,
    private val login: LoginSessionService,
    private val limits: AuthRateLimiter,
) {
    @GetMapping fun get() = settings.get().let { it.copy(linkAvailable = links.available(it.version)) }

    @PutMapping(Metadata.Vk.KEY)
    fun key(@RequestBody input: VkKeyInput, auth: Authentication) =
        settings.saveKey(input.version, input.key, login.accountId(auth))

    @GetMapping(Metadata.Vk.CHATS) fun chats(@RequestParam version: Long) = settings.chats(version)

    @PostMapping(Metadata.Vk.CALLBACK_SETUP)
    fun prepareCallback(@RequestBody input: VkCallbackSetupInput, auth: Authentication) =
        ResponseEntity.ok().cacheControl(CacheControl.noStore())
            .body(settings.prepareCallback(input.version, input.confirmation, login.accountId(auth)))

    @PutMapping(Metadata.Vk.CHAT)
    fun chat(@RequestBody input: VkChatInput, auth: Authentication) =
        settings.choose(input.version, input.chatId, login.accountId(auth))

    @PostMapping(Metadata.Vk.LINK)
    fun linkVkChat(@RequestBody input: VkVersionInput, auth: Authentication) =
        login.accountId(auth).let { actor ->
            limits.check("vk-link:$actor", Metadata.Vk.TEST_RATE)
            links.start(input.version, actor)
        }

    @PostMapping(Metadata.Vk.SEND_TEST)
    fun test(@RequestBody input: VkVersionInput, auth: Authentication) =
        login.accountId(auth).let { actor ->
            limits.check("vk-test:$actor", Metadata.Vk.TEST_RATE)
            settings.test(input.version, actor)
        }

    @PutMapping(Metadata.Vk.ENABLED)
    fun enabled(@RequestBody input: VkToggleInput, auth: Authentication) =
        settings.toggle(input.version, input.enabled, login.accountId(auth))
}
