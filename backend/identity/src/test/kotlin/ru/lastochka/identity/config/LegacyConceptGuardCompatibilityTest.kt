package ru.lastochka.identity.config

import java.lang.reflect.InvocationTargetException
import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import ru.lastochka.common.Metadata
import ru.lastochka.identity.repo.ConceptRepository

/** Optional proof using the actual class extracted from a previously built backend image. */
class LegacyConceptGuardCompatibilityTest {
    @Test
    @EnabledIfEnvironmentVariable(named = "LASTOCHKA_OLD_CONCEPT_CLASS", matches = ".+")
    fun `previous backend guard accepts legacy mode and rejects permanent mode`() {
        val bytes = Files.readAllBytes(Path.of(System.getenv("LASTOCHKA_OLD_CONCEPT_CLASS")))
        val loader = object : ClassLoader(ConceptGuard::class.java.classLoader) {
            fun define() = defineClass("ru.lastochka.identity.config.ConceptGuard", bytes, 0, bytes.size)
        }
        val constructor = loader.define().getConstructor(ConceptRepository::class.java)
        val repository = mock(ConceptRepository::class.java)
        `when`(repository.mode()).thenReturn(Metadata.Concept.MODE)
        assertNotNull(constructor.newInstance(repository))
        `when`(repository.mode()).thenReturn(Metadata.Concept.PERMANENT_SCHEDULE_MODE)
        val failure = assertThrows(InvocationTargetException::class.java) { constructor.newInstance(repository) }
        assertTrue(failure.cause is IllegalArgumentException)
        assertEquals("Incompatible studio concept", failure.cause?.message)
    }
}
