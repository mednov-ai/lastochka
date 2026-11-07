package ru.lastochka.payments.controller

import org.springframework.http.ResponseEntity
import org.springframework.util.MultiValueMap
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import io.swagger.v3.oas.annotations.Parameter
import ru.lastochka.common.Metadata
import ru.lastochka.payments.service.AlfaCallbackService

@RestController
class AlfaCallbackController(private val callback: AlfaCallbackService) {
    @GetMapping(Metadata.AlfaPayment.CALLBACK)
    fun accept(@Parameter(hidden = true) @RequestParam params: MultiValueMap<String, String>): ResponseEntity<Void> =
        if (callback.accept(params)) ResponseEntity.ok().build()
        else ResponseEntity.notFound().build()
}
