package ru.lastochka.enquiries.service

import java.util.UUID
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.FieldValidationException
import ru.lastochka.enquiries.dto.EnquiryInput
import ru.lastochka.enquiries.dto.EnquiryParticipantType

// Preserve the legacy idempotency representation during rolling upgrades.
private data class LegacyEnquiryHashInput(
    val parentName: String,
    val phone: String,
    val childName: String?,
    val childAge: Int?,
    val desiredSessionId: UUID?,
    val desiredSessionVersion: Long?,
    val comment: String?,
)

internal fun enquiryHashInput(input: EnquiryInput): Any =
    if (input.contractVersion == null)
        LegacyEnquiryHashInput(
            input.parentName, input.phone, input.childName, input.childAge,
            input.desiredSessionId, input.desiredSessionVersion, input.comment,
        )
    else input

internal fun validateEnquiryParticipant(input: EnquiryInput) {
    if (input.childAge != null && input.childAge !in 0..Metadata.Concept.MAX_AGE)
        throw FieldValidationException(mapOf("childAge" to Metadata.Concept.FIELD_AGE))
    val required = Metadata.ErrorCodes.FIELD_REQUIRED
    val invalid = Metadata.ErrorCodes.FIELD_INVALID
    val errors = mutableMapOf<String, String>()
    input.calculatedSession?.let { reference ->
        if (input.contractVersion != Metadata.Concept.ENQUIRY_PARTICIPANT_VERSION ||
            reference.referenceVersion != 1 || reference.seriesVersion < 1 ||
            input.desiredSessionId != null || input.desiredSessionVersion != null)
            errors["calculatedSession"] = invalid
    }
    when (input.contractVersion) {
        null -> {
            if (input.participantType != null) errors["participantType"] = invalid
            if (input.participantAge != null) errors["participantAge"] = invalid
        }
        Metadata.Concept.ENQUIRY_PARTICIPANT_VERSION -> when (input.participantType) {
            null -> errors["participantType"] = required
            EnquiryParticipantType.CHILD -> {
                if (input.childName == null) errors["childName"] = required
                if (input.childAge == null) errors["childAge"] = required
                if (input.participantAge != null) errors["participantAge"] = invalid
            }
            EnquiryParticipantType.SELF -> {
                if (input.participantAge == null) errors["participantAge"] = required
                else if (input.participantAge !in 0..Metadata.Concept.MAX_PARTICIPANT_AGE)
                    errors["participantAge"] = Metadata.Concept.FIELD_PARTICIPANT_AGE
                if (input.childName != null) errors["childName"] = invalid
                if (input.childAge != null) errors["childAge"] = invalid
            }
        }
        else -> errors["contractVersion"] = invalid
    }
    if (errors.isNotEmpty()) throw FieldValidationException(errors)
}
