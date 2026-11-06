package ru.lastochka.payments.service

import java.util.UUID
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.*
import ru.lastochka.common.service.CommandService
import ru.lastochka.common.service.ContactValidation
import ru.lastochka.payments.dto.*
import ru.lastochka.payments.repo.PaymentRepository
import ru.lastochka.identity.service.StaffAccessService

@Service
class PaymentService(
    private val storage: PaymentRepository,
    private val commands: CommandService,
    private val access: StaffAccessService,
) {
    fun find(id: UUID) = storage.find(id) ?: notFound(Metadata.ErrorCodes.NOT_FOUND)

    fun page(page: Int): PaymentPage {
        if (page < 0) badRequest(Metadata.ErrorCodes.INVALID_PAGE)
        return storage.page(page)
    }

    @Transactional
    fun save(actor: UUID, id: UUID?, input: PaymentInput): PaymentView {
        if (input.amountMinor !in 1..Metadata.Concept.MAX_MINOR)
            throw FieldValidationException(mapOf("amountMinor" to Metadata.Concept.FIELD_AMOUNT))
        val value =
            input.copy(
                recipientName = ContactValidation.name(input.recipientName, "recipientName"),
                phone = ContactValidation.phone(input.phone),
                purpose = input.purpose.trim(),
            )
        if (value.purpose.isBlank() || value.purpose.length > Metadata.Concept.MAX_PURPOSE)
            throw FieldValidationException(mapOf("purpose" to Metadata.ErrorCodes.FIELD_LENGTH))
        commands.lockStudio()
        val before = id?.let(::find)
        if (value.enquiryId != null && before?.enquiryId != value.enquiryId)
            access.requireEnquiryAccess(actor)
        val selected = id ?: UUID.randomUUID()
        if (storage.save(selected, actor, value, id == null) != 1)
            conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
        val after = find(selected)
        commands.audit(
            selected,
            actor,
            if (id == null) Metadata.Concept.PAYMENT_CREATED else Metadata.Concept.PAYMENT_UPDATED,
            before,
            after,
        )
        return after
    }

    fun issue(id: UUID): Nothing {
        find(id)
        conflict(Metadata.Concept.PAYMENT_PROVIDER_NOT_CONFIGURED)
    }
}
