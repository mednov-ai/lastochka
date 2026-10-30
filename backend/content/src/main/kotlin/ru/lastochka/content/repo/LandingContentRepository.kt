package ru.lastochka.content.repo

import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import ru.lastochka.content.entity.LandingContentEntity

interface LandingContentRepository : JpaRepository<LandingContentEntity, Int> {
    @Query("select content.payload from LandingContentEntity content where content.id = 1")
    fun publishedPayload(): String
}
