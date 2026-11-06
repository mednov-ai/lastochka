package ru.lastochka.identity.controller

import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.Valid
import java.util.UUID
import org.springframework.http.HttpStatus
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.*
import ru.lastochka.common.Metadata
import ru.lastochka.identity.dto.*
import ru.lastochka.identity.service.UserManagementService

@RestController
@RequestMapping(Metadata.PasswordLifecycle.USERS)
class UserManagementController(private val users: UserManagementService) {
    @GetMapping
    fun list(
        auth: Authentication,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "25") size: Int,
    ): UserPage = users.list(auth, page, size)

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(
        req: HttpServletRequest,
        auth: Authentication,
        @Valid @RequestBody input: CreateUserRequest,
    ): UserView = users.create(req, auth, input)

    @PostMapping(Metadata.PasswordLifecycle.TEMPORARY_SUFFIX)
    fun reset(
        req: HttpServletRequest,
        auth: Authentication,
        @PathVariable id: UUID,
        @Valid @RequestBody input: TemporaryPasswordRequest,
    ): UserView = users.reset(req, auth, id, input)

    @PutMapping(Metadata.StaffAccess.ACCESS_SUFFIX)
    fun changeAccess(
        req: HttpServletRequest,
        auth: Authentication,
        @PathVariable id: UUID,
        @Valid @RequestBody input: UserAccessRequest,
    ): UserView = users.changeAccess(req, auth, id, input)
}
