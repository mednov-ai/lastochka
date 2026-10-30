package ru.lastochka.common.entity

import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table

@Entity @Table(name = "studio_settings") class StudioSettingsEntity(@Id val id: Int = 0)
