package ru.lastochka.identity.config

import org.springframework.boot.sql.init.dependency.DependsOnDatabaseInitialization
import org.springframework.stereotype.Component
import ru.lastochka.common.Metadata
import ru.lastochka.identity.repo.ConceptRepository

@Component
@DependsOnDatabaseInitialization
class ConceptGuard(storage: ConceptRepository) {
    init {
        require(storage.mode() in setOf(Metadata.Concept.MODE, Metadata.Concept.PERMANENT_SCHEDULE_MODE)) {
            "Incompatible studio concept"
        }
    }
}
