package ru.lastochka.content.repo

import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository

@Repository
class LandingContentRepository(private val jdbc: JdbcClient) {
    fun publishedPayload() =
        jdbc
            .sql("SELECT payload::text FROM landing_content WHERE id=1")
            .query(String::class.java)
            .single()
}
