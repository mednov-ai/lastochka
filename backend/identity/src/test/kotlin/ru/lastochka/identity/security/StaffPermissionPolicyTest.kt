package ru.lastochka.identity.security

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import ru.lastochka.common.Metadata.StaffAccess as Access

class StaffPermissionPolicyTest {
    @Test
    fun `route methods are independently classified and unknown commands denied`() {
        val cases =
            listOf(
                Triple("GET", "/api/v1/admin/calendar", Access.SCHEDULE_VIEW),
                Triple("GET", "/api/v1/admin/sessions/one/draft", Access.SCHEDULE_VIEW),
                Triple("POST", "/api/v1/admin/session-series/one/preview", Access.SCHEDULE_EDIT),
                Triple("PUT", "/api/v1/admin/sessions/one/draft", Access.SCHEDULE_EDIT),
                Triple("GET", "/api/v1/admin/payment-requests/one", Access.PAYMENT_VIEW),
                Triple("PUT", "/api/v1/admin/payment-requests/one", Access.PAYMENT_EDIT),
                Triple("GET", "/api/v1/admin/enquiries/one/browser-push", Access.ENQUIRIES_VIEW),
                Triple("POST", "/api/v1/admin/enquiries/one/delivery/retry", Access.ENQUIRIES_VIEW),
                Triple("DELETE", "/api/v1/admin/browser-push/subscriptions/one", Access.SELF),
            )
        cases.forEach { (method, path, permission) ->
            assertEquals(permission, StaffPermissionPolicy.required(method, path), "$method $path")
        }
        listOf(
            "POST" to "/api/v1/admin/users",
            "PUT" to "/api/v1/admin/enquiry-notification-settings",
            "POST" to "/api/v1/admin/enquiries/one",
            "DELETE" to "/api/v1/admin/payment-requests/one",
            "GET" to "/api/v1/admin/future-feature",
        ).forEach { (method, path) -> assertNull(StaffPermissionPolicy.required(method, path)) }
    }

    @Test
    fun `edit implies only its own read permission`() {
        assertTrue(StaffPermissionPolicy.includes(setOf(Access.SCHEDULE_EDIT), Access.SCHEDULE_VIEW))
        assertTrue(StaffPermissionPolicy.includes(setOf(Access.PAYMENT_EDIT), Access.PAYMENT_VIEW))
        assertFalse(StaffPermissionPolicy.includes(setOf(Access.SCHEDULE_VIEW), Access.SCHEDULE_EDIT))
        assertFalse(StaffPermissionPolicy.includes(setOf(Access.SCHEDULE_EDIT), Access.PAYMENT_VIEW))
        assertFalse(StaffPermissionPolicy.includes(emptySet(), Access.ENQUIRIES_VIEW))
        assertTrue(StaffPermissionPolicy.includes(emptySet(), Access.SELF))
    }

    @Test
    fun `every combination preserves independent rights`() {
        val values = Access.ALL.sorted()
        for (mask in 0 until (1 shl values.size)) {
            val granted = values.filterIndexed { i, _ -> mask and (1 shl i) != 0 }.toSet()
            for (permission in values) {
                val expected = permission in granted ||
                    (permission == Access.SCHEDULE_VIEW && Access.SCHEDULE_EDIT in granted) ||
                    (permission == Access.PAYMENT_VIEW && Access.PAYMENT_EDIT in granted)
                assertEquals(expected, StaffPermissionPolicy.includes(granted, permission), "$granted -> $permission")
            }
            assertFalse(StaffPermissionPolicy.includes(granted, "UNKNOWN"))
        }
    }
}
