package ru.lastochka.scheduling.service

import java.time.Clock
import java.util.UUID
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.*
import ru.lastochka.common.service.CommandService
import ru.lastochka.scheduling.dto.*
import ru.lastochka.scheduling.repo.SessionDraftRepository

@Service
class SessionEditorService(
    private val sessions: SchedulingService,
    private val drafts: SessionDraftRepository,
    private val commands: CommandService,
    private val clock: Clock,
    private val recurrence: ru.lastochka.scheduling.repo.RecurrenceRepository,
) {
    fun read(id: UUID) = SessionEditorView(sessions.find(id), drafts.find(id))

    fun history(id: UUID, page: Int): SessionHistory {
        sessions.find(id)
        if (page < 0) badRequest(Metadata.ErrorCodes.INVALID_PAGE)
        return drafts.history(id, page)
    }

    private fun check(id: UUID, version: Long, draftVersion: Long?): SessionEditorView {
        val state = read(id)
        if (state.session.version != version || state.draft?.version != draftVersion)
            conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
        if (state.session.status !in setOf(Metadata.Scheduling.OPEN, Metadata.Scheduling.CLOSED))
            conflict(Metadata.ErrorCodes.SESSION_UNAVAILABLE)
        return state
    }

    @Transactional
    fun save(actor: UUID, id: UUID, key: String, input: SaveSessionDraft): SessionEditorView =
        commands.execute(
            actor,
            "session-draft-save:$id",
            key,
            input,
            SessionEditorView::class.java,
        ) {
            val state = check(id, input.expectedSessionVersion, input.expectedDraftVersion)
            sessions.validateExistingSession(input.session)
            drafts.save(
                id,
                actor,
                state.session.version,
                input.session.copy(replaceAgeRange = true),
                clock.instant(),
            )
            recurrence.touch(id, false)
            val after = read(id)
            commands.audit(id, actor, Metadata.Editor.SAVED, state.draft, after.draft)
            after
        }

    @Transactional
    fun discard(actor: UUID, id: UUID, key: String, input: DraftCommand): SessionEditorView =
        commands.execute(
            actor,
            "session-draft-discard:$id",
            key,
            input,
            SessionEditorView::class.java,
        ) {
            val state = check(id, input.expectedSessionVersion, input.expectedDraftVersion)
            drafts.delete(id)
            recurrence.touch(id, false)
            commands.audit(id, actor, Metadata.Editor.DISCARDED, state.draft, null)
            read(id)
        }

    @Transactional
    fun publish(actor: UUID, id: UUID, key: String, input: DraftCommand): SessionEditorView =
        commands.execute(
            actor,
            "session-draft-publish:$id",
            key,
            input,
            SessionEditorView::class.java,
        ) {
            val state = check(id, input.expectedSessionVersion, input.expectedDraftVersion)
            val draft = state.draft ?: conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
            if (draft.baseSessionVersion != state.session.version)
                conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
            sessions.update(
                actor,
                id,
                UUID.nameUUIDFromBytes(key.toByteArray()).toString(),
                SessionUpdate(state.session.version, draft.session.copy(replaceAgeRange = true)),
            )
            drafts.delete(id)
            recurrence.touch(id, false)
            val after = read(id)
            commands.audit(id, actor, Metadata.Editor.PUBLISHED, state.session, after.session)
            after
        }

    @Transactional
    fun restore(
        actor: UUID,
        id: UUID,
        revision: Long,
        key: String,
        input: DraftCommand,
    ): SessionEditorView =
        commands.execute(
            actor,
            "session-draft-restore:$id:$revision",
            key,
            input,
            SessionEditorView::class.java,
        ) {
            val state = check(id, input.expectedSessionVersion, input.expectedDraftVersion)
            val params = drafts.revision(id, revision) ?: notFound(Metadata.ErrorCodes.NOT_FOUND)
            sessions.validateExistingSession(params)
            drafts.save(
                id,
                actor,
                state.session.version,
                params.copy(replaceAgeRange = true),
                clock.instant(),
            )
            recurrence.touch(id, false)
            val after = read(id)
            commands.audit(id, actor, Metadata.Editor.RESTORED, state.draft, after.draft)
            after
        }
}
