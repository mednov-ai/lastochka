package ru.lastochka.config

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import ru.lastochka.common.Metadata

/** Read the bootstrap secret without putting it into a container's environment. */
internal object AdminBootstrapPassword {
    fun resolve(environment: Map<String, String>): String {
        val file = environment[Metadata.Protocol.LASTOCHKA_ADMIN_PASSWORD_FILE]
        val value = environment[Metadata.Protocol.LASTOCHKA_ADMIN_PASSWORD]
        require((file != null) xor (value != null)) {
            "Specify exactly one administrator password source"
        }
        if (file == null) return requireNotNull(value)
        val path = Path.of(file)
        require(path.isAbsolute && Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) {
            "Administrator password file must be an absolute regular file"
        }
        require(Files.size(path) in 1..Metadata.Password.BOOTSTRAP_FILE_MAX_BYTES) {
            "Invalid administrator password file size"
        }
        val decoder =
            StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
        return decoder.decode(ByteBuffer.wrap(Files.readAllBytes(path))).toString()
    }
}
