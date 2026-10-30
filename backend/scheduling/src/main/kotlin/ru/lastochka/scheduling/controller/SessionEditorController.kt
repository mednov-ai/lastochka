package ru.lastochka.scheduling.controller

import jakarta.validation.Valid
import java.util.UUID
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.*
import ru.lastochka.common.Metadata
import ru.lastochka.identity.service.LoginSessionService
import ru.lastochka.scheduling.dto.*
import ru.lastochka.scheduling.service.SessionEditorService

@RestController
@RequestMapping(Metadata.Editor.ROOT)
class SessionEditorController(
    private val editor: SessionEditorService,
    private val login: LoginSessionService,
) {
    @GetMapping(Metadata.Editor.DRAFT) fun read(@PathVariable id: UUID) = editor.read(id)

    @PutMapping(Metadata.Editor.DRAFT)
    fun save(
        auth: Authentication,
        @PathVariable id: UUID,
        @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: String,
        @Valid @RequestBody input: SaveSessionDraft,
    ) = editor.save(login.accountId(auth), id, key, input)

    @DeleteMapping(Metadata.Editor.DRAFT)
    fun discard(
        auth: Authentication,
        @PathVariable id: UUID,
        @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: String,
        @RequestBody input: DraftCommand,
    ) = editor.discard(login.accountId(auth), id, key, input)

    @PostMapping(Metadata.Editor.PUBLISH)
    fun publish(
        auth: Authentication,
        @PathVariable id: UUID,
        @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: String,
        @RequestBody input: DraftCommand,
    ) = editor.publish(login.accountId(auth), id, key, input)

    @GetMapping(Metadata.Editor.HISTORY)
    fun history(@PathVariable id: UUID, @RequestParam(defaultValue = "0") page: Int) =
        editor.history(id, page)

    @PostMapping(Metadata.Editor.RESTORE)
    fun restore(
        auth: Authentication,
        @PathVariable id: UUID,
        @PathVariable revisionId: Long,
        @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: String,
        @RequestBody input: DraftCommand,
    ) = editor.restore(login.accountId(auth), id, revisionId, key, input)
}
