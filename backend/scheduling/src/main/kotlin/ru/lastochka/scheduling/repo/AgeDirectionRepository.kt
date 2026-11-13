package ru.lastochka.scheduling.repo

import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import ru.lastochka.scheduling.entity.AgeDirection

interface AgeDirectionRepository : JpaRepository<AgeDirection, UUID> {
    fun findAllByOrderBySortOrderAscTitleAscIdAsc(): List<AgeDirection>

    fun findAllByActiveTrueOrderBySortOrderAscTitleAscIdAsc(): List<AgeDirection>
}
