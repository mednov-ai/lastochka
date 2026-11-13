package ru.lastochka.identity.repo

import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.jpa.repository.Modifying
import ru.lastochka.identity.entity.ConceptState

interface ConceptRepository : JpaRepository<ConceptState, Int> {
    @Query("select c.mode from ConceptState c where c.id = 1") fun mode(): String

    @Modifying
    @Query(value = "UPDATE concept_state SET mode=:next,switched_at=now() WHERE id=1 AND mode=:current", nativeQuery = true)
    fun transition(current: String, next: String): Int
}
