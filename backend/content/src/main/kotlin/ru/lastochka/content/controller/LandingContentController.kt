package ru.lastochka.content.controller

import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import ru.lastochka.common.Metadata
import ru.lastochka.content.dto.LandingContent
import ru.lastochka.content.service.LandingContentService

@RestController
@RequestMapping(Metadata.Routes.API_V1_PUBLIC_LANDING)
class LandingContentController(private val content: LandingContentService) {
    @GetMapping
    fun published(): ResponseEntity<LandingContent> {
        val doc = content.published()
        return ResponseEntity.ok()
            .eTag("landing-${doc.revision}")
            .header("Cache-Control", "public, no-cache")
            .body(doc)
    }
}
