package ru.lastochka.identity.repo

import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import ru.lastochka.identity.entity.ConceptState

interface ConceptRepository : JpaRepository<ConceptState, Int> {
    @Query("select c.mode from ConceptState c where c.id = 1") fun mode(): String
}
