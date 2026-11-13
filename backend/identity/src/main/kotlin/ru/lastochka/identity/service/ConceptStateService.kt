package ru.lastochka.identity.service

import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.identity.repo.ConceptRepository

/** Exposes the compatibility state without leaking the identity repository across modules. */
@Service
class ConceptStateService(private val repository: ConceptRepository) {
    fun mode(): String = repository.mode()

    @Transactional(propagation = Propagation.MANDATORY)
    fun transition(current: String, next: String): Int = repository.transition(current, next)
}
