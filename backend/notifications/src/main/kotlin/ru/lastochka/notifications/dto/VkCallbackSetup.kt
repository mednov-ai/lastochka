package ru.lastochka.notifications.dto

class VkCallbackSetupInput(val version: Long, val confirmation: String? = null)

class VkCallbackSetup(val url: String, val secret: String, val version: Long, val confirmationSaved: Boolean)
