package ru.lastochka.identity.repo

import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository

@Repository
class ConceptRepository(private val jdbc: JdbcClient) {
    fun mode(): String =
        jdbc.sql("SELECT mode FROM concept_state WHERE id=1").query(String::class.java).single()
}
