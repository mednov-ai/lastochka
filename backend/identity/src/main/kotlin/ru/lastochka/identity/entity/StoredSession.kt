package ru.lastochka.identity.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes

@Entity
@Table(name = "spring_session")
class StoredSession(
    @Id
    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name = "primary_id", columnDefinition = "char(36)")
    val id: String = "",
    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name = "session_id", columnDefinition = "char(36)")
    val sessionId: String = "",
    @Column(name = "principal_name") val principalName: String? = null,
)
