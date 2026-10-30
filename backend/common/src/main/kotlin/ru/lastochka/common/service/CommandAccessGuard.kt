package ru.lastochka.common.service

/** Recheck request admission after obtaining the shared command lock. */
fun interface CommandAccessGuard {
    fun check()
}
