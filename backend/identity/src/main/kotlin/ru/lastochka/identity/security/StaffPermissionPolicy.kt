package ru.lastochka.identity.security

import ru.lastochka.common.Metadata

/** Closed catalogue of staff routes. An unrecognised method or path is denied. */
object StaffPermissionPolicy {
    private const val ROOT = "/api/v1/admin"
    private val id = "[^/]+"
    private val sessionsRead = Regex("$ROOT/sessions(?:/$id/(?:draft|history))?")
    private val sessionItem = Regex("$ROOT/sessions/$id")
    private val sessionAction = Regex("$ROOT/sessions/$id/(?:actions|draft/publish|history/$id/restore-draft)")
    private val sessionDraft = Regex("$ROOT/sessions/$id/draft")
    private val groupsRead = Regex("$ROOT/schedule-groups(?:/$id/history)?")
    private val groupItem = Regex("$ROOT/schedule-groups/$id")
    private val seriesRead = Regex("$ROOT/session-series(?:/$id(?:/history)?)?")
    private val seriesPost = Regex("$ROOT/session-series(?:/preview|/new-group(?:/preview)?|/$id/(?:preview|publish))?")
    private val seriesDraft = Regex("$ROOT/session-series/$id/draft")
    private val paymentItem = Regex("$ROOT/payment-requests/$id")
    private val paymentIssue = Regex("$ROOT/payment-requests/$id/(?:issue|refresh|cancel|archive|link)")
    private val enquiryItem = Regex("$ROOT/enquiries/$id(?:/delivery|/browser-push)?")
    private val enquiryRetry = Regex("$ROOT/enquiries/$id/delivery/retry")
    private val pushItem = Regex("$ROOT/browser-push/subscriptions/$id")

    fun required(method: String, path: String): String? {
        val read = method == Metadata.Identity.GET
        return when {
            read && (path == "$ROOT/calendar" || sessionsRead.matches(path) ||
                groupsRead.matches(path) || seriesRead.matches(path)) -> Metadata.StaffAccess.SCHEDULE_VIEW
            (method == Metadata.Identity.POST && (path == "$ROOT/sessions" || sessionAction.matches(path) ||
                path == "$ROOT/schedule-groups" || seriesPost.matches(path))) ||
                (method == Metadata.Identity.PUT && (sessionItem.matches(path) || sessionDraft.matches(path) ||
                    groupItem.matches(path) || seriesDraft.matches(path))) ||
                (method == Metadata.Identity.DELETE && (sessionDraft.matches(path) || seriesDraft.matches(path))) ->
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
