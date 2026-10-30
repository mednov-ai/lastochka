package ru.lastochka.content.service

import org.springframework.stereotype.Service
import ru.lastochka.common.Metadata
import ru.lastochka.content.dto.LandingContent
import ru.lastochka.content.repo.LandingContentRepository
import tools.jackson.databind.json.JsonMapper

@Service
class LandingContentService(
    private val storage: LandingContentRepository,
    private val json: JsonMapper,
) {
    fun published(): LandingContent =
        json
            .readValue(
                storage.publishedPayload(),
                LandingContent::class.java,
            )
            .also { doc ->
                check(doc.schemaVersion == 1 && doc.revision > 0) { "Unsupported content document" }
                check(doc.blocks.map { it.id }.distinct().size == doc.blocks.size) {
                    "Duplicate block identifier"
                }
                check(
                    doc.blocks.all {
                        it.id.matches(Regex(Metadata.Content.BLOCK_ID_PATTERN)) &&
                            (it.image == null ||
                                it.image.matches(Regex(Metadata.Content.IMAGE_FILE_PATTERN)))
                    }
                ) {
                    "Invalid content resource"
                }
                check(doc.telegram.matches(Regex(Metadata.Content.TELEGRAM_PATTERN))) {
                    "Invalid contact"
                }
            }
}
