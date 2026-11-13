package ru.lastochka.enquiries.service

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import ru.lastochka.common.error.FieldValidationException
import ru.lastochka.enquiries.dto.EnquiryInput
import ru.lastochka.scheduling.dto.ScheduleRuleReference
import ru.lastochka.enquiries.dto.EnquiryParticipantType
import tools.jackson.databind.json.JsonMapper
import java.util.UUID
import java.time.LocalDate

private data class OldEnquiryInput(
    val parentName: String,
    val phone: String,
    val childName: String? = null,
    val childAge: Int? = null,
    val desiredSessionId: UUID? = null,
    val desiredSessionVersion: Long? = null,
    val comment: String? = null,
)

private data class OldV2EnquiryInput(
    val parentName: String,
    val phone: String,
    val childName: String? = null,
    val childAge: Int? = null,
    val desiredSessionId: UUID? = null,
    val desiredSessionVersion: Long? = null,
    val comment: String? = null,
    val contractVersion: Int? = null,
    val participantType: EnquiryParticipantType? = null,
    val participantAge: Int? = null,
)

class EnquiryParticipantValidationTest {
    private val legacy = EnquiryInput(parentName = "Родитель", phone = "+79001234567")

    @Test
    fun `previous requests remain valid and keep their exact replay payload`() {
        validateEnquiryParticipant(legacy)
        val mapper = JsonMapper.builder().build()
        assertEquals(mapper.writeValueAsString(OldEnquiryInput("Родитель", "+79001234567")),
            mapper.writeValueAsString(enquiryHashInput(legacy)))
    }

    @Test
    fun `v2 replay representation is unchanged unless a calculated reference is supplied`() {
        val mapper = JsonMapper.builder().build()
        val v2 = legacy.copy(contractVersion = 2, participantType = EnquiryParticipantType.SELF, participantAge = 34)
        assertEquals(mapper.writeValueAsString(OldV2EnquiryInput("Родитель", "+79001234567", contractVersion = 2, participantType = EnquiryParticipantType.SELF, participantAge = 34)), mapper.writeValueAsString(enquiryHashInput(v2)))
        val ref = ScheduleRuleReference(1, UUID.randomUUID(), LocalDate.parse("2040-01-09"), 1)
        validateEnquiryParticipant(v2.copy(calculatedSession = ref))
        assertThrows(FieldValidationException::class.java) { validateEnquiryParticipant(legacy.copy(calculatedSession = ref)) }
        assertThrows(FieldValidationException::class.java) { validateEnquiryParticipant(v2.copy(calculatedSession = ref, desiredSessionId = UUID.randomUUID())) }
        assertThrows(FieldValidationException::class.java) { validateEnquiryParticipant(v2.copy(calculatedSession = ref.copy(referenceVersion = 2))) }
    }

    @Test
    fun `new requests require the fields of the selected participant`() {
        val child = legacy.copy(contractVersion = 2, participantType = EnquiryParticipantType.CHILD)
        val error = assertThrows(FieldValidationException::class.java) { validateEnquiryParticipant(child) }
        assertEquals(setOf("childName", "childAge"), error.fieldCodes.keys)
        validateEnquiryParticipant(child.copy(childName = "Маша", childAge = 8))
        val self = legacy.copy(contractVersion = 2, participantType = EnquiryParticipantType.SELF, participantAge = 34)
        validateEnquiryParticipant(self)
        assertEquals("FIELD_PARTICIPANT_AGE", assertThrows(FieldValidationException::class.java) {
            validateEnquiryParticipant(self.copy(participantAge = 121))
        }.fieldCodes["participantAge"])
        assertTrue(assertThrows(FieldValidationException::class.java) {
            validateEnquiryParticipant(self.copy(childAge = 8))
        }.fieldCodes.containsKey("childAge"))
        assertTrue(assertThrows(FieldValidationException::class.java) {
            validateEnquiryParticipant(legacy.copy(participantType = EnquiryParticipantType.SELF, participantAge = 34))
        }.fieldCodes.containsKey("participantType"))
    }
}
