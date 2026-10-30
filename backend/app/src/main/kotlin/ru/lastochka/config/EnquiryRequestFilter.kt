package ru.lastochka.config

import jakarta.servlet.FilterChain
import jakarta.servlet.ReadListener
import jakarta.servlet.ServletInputStream
import jakarta.servlet.http.*
import java.io.ByteArrayInputStream
import org.springframework.http.HttpStatus
import org.springframework.web.filter.OncePerRequestFilter
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.ApiErrorFactory
import tools.jackson.databind.json.JsonMapper

class EnquiryRequestFilter(
    private val json: JsonMapper,
    private val errors: ApiErrorFactory,
    private val origin: String,
) : OncePerRequestFilter() {
    override fun doFilterInternal(
        req: HttpServletRequest,
        res: HttpServletResponse,
        chain: FilterChain,
    ) {
        if (
            req.requestURI.removePrefix(req.contextPath) != Metadata.Concept.PUBLIC_ENQUIRIES ||
                req.method == Metadata.Identity.GET
        ) {
            chain.doFilter(req, res)
            return
        }
        if (req.getHeader("Origin")?.let { it != origin } == true) {
            reject(res, HttpStatus.FORBIDDEN, Metadata.ErrorCodes.ACCESS_DENIED)
            return
        }
        val body = req.inputStream.readNBytes(Metadata.Concept.MAX_REQUEST_BYTES + 1)
        if (body.size > Metadata.Concept.MAX_REQUEST_BYTES) {
            reject(res, HttpStatus.PAYLOAD_TOO_LARGE, Metadata.ErrorCodes.VALIDATION_ERROR)
            return
        }
        val wrapped =
            object : HttpServletRequestWrapper(req) {
                override fun getInputStream(): ServletInputStream {
                    val input = ByteArrayInputStream(body)
                    return object : ServletInputStream() {
                        override fun read(): Int = input.read()

                        override fun isFinished() = input.available() == 0

                        override fun isReady() = true

                        override fun setReadListener(listener: ReadListener) {
                            throw IllegalStateException("Synchronous request only")
                        }
                    }
                }
            }
        chain.doFilter(wrapped, res)
    }

    private fun reject(res: HttpServletResponse, status: HttpStatus, code: String) {
        res.status = status.value()
        res.contentType = Metadata.Protocol.PROBLEM_JSON
        json.writeValue(res.outputStream, errors.body(res.status, code))
    }
}
