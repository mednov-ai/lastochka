package ru.lastochka.config

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.web.filter.OncePerRequestFilter
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.ApiErrorFactory
import tools.jackson.databind.json.JsonMapper

class LegacyEndpointFilter(private val json: JsonMapper, private val errors: ApiErrorFactory) :
    OncePerRequestFilter() {
    override fun doFilterInternal(
        req: HttpServletRequest,
        res: HttpServletResponse,
        chain: FilterChain,
    ) {
        val path = req.requestURI.removePrefix(req.contextPath)
        if (
            Metadata.Concept.LEGACY_PREFIXES.any { path == it || path.startsWith("$it/") } ||
                Regex(Metadata.Concept.LEGACY_SESSION_PATH).matches(path)
        ) {
            res.status = org.springframework.http.HttpStatus.GONE.value()
            res.contentType = Metadata.Protocol.PROBLEM_JSON
            res.setHeader("Cache-Control", "no-store")
            json.writeValue(
                res.outputStream,
                errors.body(res.status, Metadata.Concept.LEGACY_REMOVED),
            )
            return
        }
        chain.doFilter(req, res)
    }
}
