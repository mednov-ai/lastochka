package ru.lastochka.identity.entity

import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table

@Entity
@Table(name = "concept_state")
class ConceptState(@Id val id: Int = 0, val mode: String = "")
