package ru.lastochka.identity.config

import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import ru.lastochka.common.Metadata
import ru.lastochka.identity.repo.ConceptRepository

class ConceptGuardTest {
    @Test
    fun `accepts both supported modes but rejects unknown modes`() {
        val repository = mock(ConceptRepository::class.java)
        `when`(repository.mode()).thenReturn(Metadata.Concept.MODE)
        ConceptGuard(repository)
        `when`(repository.mode()).thenReturn(Metadata.Concept.PERMANENT_SCHEDULE_MODE)
        ConceptGuard(repository)
        `when`(repository.mode()).thenReturn("UNKNOWN_MODE")
        assertThrows(IllegalArgumentException::class.java) { ConceptGuard(repository) }
    }
}
