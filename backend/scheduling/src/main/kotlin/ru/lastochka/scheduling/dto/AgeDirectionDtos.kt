package ru.lastochka.scheduling.dto

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema
import java.util.UUID

@Schema(
    requiredProperties =
        ["id", "title", "description", "ageFrom", "ageOpenEnded", "active", "sortOrder", "version"]
)
data class AgeDirectionView(
    val id: UUID,
    val title: String,
    val description: String,
    val ageFrom: Int,
    val ageTo: Int?,
    val ageOpenEnded: Boolean,
    val active: Boolean,
    val sortOrder: Int,
    val version: Long,
)

@Schema(requiredProperties = ["items"])
data class AgeDirectionList(val items: List<AgeDirectionView>)

@Schema(
    requiredProperties =
        [
            "title",
            "description",
            "ageFrom",
            "ageOpenEnded",
            "active",
            "sortOrder",
            "expectedVersion",
        ]
)
data class AgeDirectionUpdate(
    val title: String,
    val description: String,
    @param:JsonProperty(required = true) val ageFrom: Int,
    val ageTo: Int?,
    @param:JsonProperty(required = true) val ageOpenEnded: Boolean,
    @param:JsonProperty(required = true) val active: Boolean,
    @param:JsonProperty(required = true) val sortOrder: Int,
    @param:JsonProperty(required = true) val expectedVersion: Long,
)
