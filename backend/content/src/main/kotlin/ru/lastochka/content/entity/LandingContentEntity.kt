package ru.lastochka.content.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes

@Entity
@Table(name = "landing_content")
class LandingContentEntity(
    @Id val id: Int = 0,
    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition = "jsonb") val payload: String = "",
)
