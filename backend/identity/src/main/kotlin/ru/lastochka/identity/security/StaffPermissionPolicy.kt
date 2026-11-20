package ru.lastochka.identity.security

import ru.lastochka.common.Metadata

/** Closed catalogue of staff routes. An unrecognised method or path is denied. */
object StaffPermissionPolicy {
    private const val ROOT = "/api/v1/admin"
    private val id = "[^/]+"
    private const val WEEKLY = "$ROOT/schedule/weekly"
    private val weeklyItem = Regex("$WEEKLY/$id")
    private val paymentItem = Regex("$ROOT/payment-requests/$id")
    private val paymentIssue = Regex("$ROOT/payment-requests/$id/(?:issue|refresh|cancel|archive|link)")
    private val enquiryItem = Regex("$ROOT/enquiries/$id(?:/delivery|/browser-push)?")
    private val enquiryRetry = Regex("$ROOT/enquiries/$id/delivery/retry")
    private val pushItem = Regex("$ROOT/browser-push/subscriptions/$id")

    fun required(method: String, path: String): String? {
        val read = method == Metadata.Identity.GET
        return when {
            read && path == WEEKLY -> Metadata.StaffAccess.SCHEDULE_VIEW
            method == Metadata.Identity.POST && path == WEEKLY -> Metadata.StaffAccess.SCHEDULE_EDIT
            method in setOf(Metadata.Identity.PUT, Metadata.Identity.DELETE) && weeklyItem.matches(path) ->
                Metadata.StaffAccess.SCHEDULE_EDIT
            read && (path == "$ROOT/payment-requests" || paymentItem.matches(path)) -> Metadata.StaffAccess.PAYMENT_VIEW
            (method == Metadata.Identity.POST && (path == "$ROOT/payment-requests" || paymentIssue.matches(path))) ||
                (method == Metadata.Identity.PUT && paymentItem.matches(path)) -> Metadata.StaffAccess.PAYMENT_EDIT
            (read && (path == "$ROOT/enquiries" || enquiryItem.matches(path))) ||
                (method == Metadata.Identity.POST && enquiryRetry.matches(path)) -> Metadata.StaffAccess.ENQUIRIES_VIEW
            (read && (path == "$ROOT/browser-push/config" || pushItem.matches(path))) ||
                (method == Metadata.Identity.POST && path == "$ROOT/browser-push/subscriptions") ||
                (method == Metadata.Identity.DELETE && pushItem.matches(path)) -> Metadata.StaffAccess.SELF
            else -> null
        }
    }

    fun includes(granted: Set<String>, required: String): Boolean =
        required == Metadata.StaffAccess.SELF || required in granted ||
            (required == Metadata.StaffAccess.SCHEDULE_VIEW && Metadata.StaffAccess.SCHEDULE_EDIT in granted) ||
            (required == Metadata.StaffAccess.PAYMENT_VIEW && Metadata.StaffAccess.PAYMENT_EDIT in granted)
}
