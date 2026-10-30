package outside.lastochka

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

@RestController
class BackendRefactorProbe {
    @GetMapping("/api/v1/public/refactor-probe")
    fun fail(): Nothing = throw IllegalStateException("private SQL password token")
}
