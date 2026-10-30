package ru.lastochka

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.scheduling.annotation.EnableScheduling

@SpringBootApplication @EnableScheduling class LastochkaApplication

fun main(args: Array<String>) {
    runApplication<LastochkaApplication>(*args) {
        addInitializers(ru.lastochka.config.PreviewEnvironmentInitializer())
    }
}
