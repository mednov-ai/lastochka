package ru.lastochka.payments.repo

import org.springframework.data.jpa.repository.JpaRepository
import ru.lastochka.payments.entity.AlfaGatewaySelectionEntity

interface AlfaGatewaySelectionRepository : JpaRepository<AlfaGatewaySelectionEntity, Int>
