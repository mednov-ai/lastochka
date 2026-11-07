package ru.lastochka.common

/** Именованные значения контрактов и правил. Тексты — в ресурсах, SQL — в repo. */
object Metadata {
    object AlfaPayment {
        const val CALLBACK = "/api/v1/public/alfa-test/callback"
        const val REFRESH = "/api/v1/admin/payment-requests/{id}/refresh"
        const val CANCEL = "/api/v1/admin/payment-requests/{id}/cancel"
        const val ARCHIVE = "/api/v1/admin/payment-requests/{id}/archive"
        const val LINK = "/api/v1/admin/payment-requests/{id}/link"
        const val CATEGORY_ACTIVE = "ACTIVE"
        const val CATEGORY_ARCHIVED = "ARCHIVED"
        const val PAGE_SIZE = 20
        const val STATE_OPEN = "OPEN"
        const val STATE_UNKNOWN = "UNKNOWN"
        const val STATE_CANCEL_UNKNOWN = "CANCEL_UNKNOWN"
        const val STATE_PAID = "PAID"
        const val STATE_CANCELLED = "CANCELLED"
        const val STATE_DECLINED = "DECLINED"
        const val STATUS_REGISTERED = "REGISTERED"
        const val STATUS_AUTHORIZING = "AUTHORIZING"
        const val BANK_UNCONFIRMED = "BANK_UNCONFIRMED"
        const val BANK_UNAVAILABLE = "BANK_UNAVAILABLE"
        // Альфа-Банк возвращает 810 для рублёвых заказов тестового шлюза.
        const val BANK_RUB = "810"
        const val ISO_RUB = "643"
        const val RETURN_URL_SETTING = "\${lastochka.alfa.return-url:}"
        const val RETURN_PATH = "/lastochka/payments/test/return"
        const val MAX_PORT = 65535
        const val DECLINE_SETTING = "\${lastochka.alfa.decline-confirmed:false}"
        const val CALLBACK_SETTING = "\${lastochka.alfa.callback-hmac-confirmed:false}"
        const val CALLBACK_SECRET_SETTING = "\${lastochka.alfa.callback-secret-file:}"
        const val PARAM_NAME_PATTERN = "[A-Za-z][A-Za-z0-9_]{0,63}"
        const val CHECKSUM_PATTERN = "[a-fA-F0-9]{64}"
        const val CALLBACK_MAX_REQUESTS = 120
        const val SECONDS_PER_MINUTE = 60L
        const val CALLBACK_MIN_PARAMS = 5
        const val CALLBACK_MAX_PARAMS = 20
        const val CALLBACK_MAX_LENGTH = 4096
        const val CALLBACK_MAX_VALUE = 512
        const val SECRET_MAX_BYTES = 1024L
        const val KEY_MIN_BYTES = 32
        const val KEY_MAX_BYTES = 128
        const val LEASE_MINUTES = 2L
        const val RETRY_MINUTES = 5L
        const val ARCHIVE_DAYS = 7L
        const val POLL_MILLIS = 60000L
        const val BANK_AUTHORIZING = 1
        const val BANK_ACS = 5
        const val BANK_PAID = 2
        const val BANK_DECLINED = 6
    }
    object AlfaConnection {
        const val KEY_DIRECTORY = "\${lastochka.alfa.key-directory:}"
        const val KEY_ID = "\${lastochka.alfa.key-id:}"
        const val ENABLED = "\${lastochka.alfa.enabled:false}"
        const val PROBE_CONFIRMED = "\${lastochka.alfa.probe-confirmed:false}"
        const val FORM_HOSTS = "\${lastochka.alfa.form-hosts:}"
        const val CA_FILE = "\${lastochka.alfa.ca-file:}"
        const val KEY_ID_PATTERN = "[A-Za-z0-9_-]{1,32}"
        const val BASE = "/api/v1/admin/alfa-config"
        const val CANDIDATE = "/candidate"
        const val CHECK = "/candidate/check"
        const val DISABLE = "/disable"
        const val ROTATE = "/rotate-key"
        const val ROTATED = "ALFA_TEST_KEY_ROTATED"
        const val KEY_FILE_LIMIT = 256L
        const val KEY_BYTES = 32
        const val NONCE_BYTES = 12
        const val TAG_BITS = 128
        const val MIN_CIPHERTEXT = 32
        const val MAX_CIPHERTEXT = 8192
        const val AES = "AES"
        const val UNVERIFIED = "UNVERIFIED"
        const val INVALID_CREDENTIALS = "INVALID_ALFA_CREDENTIALS"
        const val CANDIDATE_SAVED = "ALFA_TEST_CANDIDATE_SAVED"
        const val CONFIG_DISABLED = "ALFA_TEST_DISABLED"
        const val CONFIG_ACTIVATED = "ALFA_TEST_CONFIG_ACTIVATED"
        const val ORDER_NOT_FOUND = "6"
        const val MAX_CREDENTIAL_LENGTH = 256
        const val MAX_FORM_URL_LENGTH = 4096
        const val HTTPS_PORT = 443
        const val CERT_FILE_LIMIT = 262144L
        const val CONNECT_TIMEOUT_SECONDS = 5L
        const val RESPONSE_TIMEOUT_SECONDS = 15L
        const val RESPONSE_LIMIT = 65536
        const val RESPONSE_READ_LIMIT = 65537
        const val HTTP_OK = 200
        const val TLS = "TLS"
    }
    object StaffAccess {
        const val STAFF = "STAFF"
        const val SELF = "SELF"
        const val SCHEDULE_VIEW = "SCHEDULE_VIEW"
        const val SCHEDULE_EDIT = "SCHEDULE_EDIT"
        const val PAYMENT_VIEW = "PAYMENT_VIEW"
        const val PAYMENT_EDIT = "PAYMENT_EDIT"
        const val ENQUIRIES_VIEW = "ENQUIRIES_VIEW"
        val ALL = setOf(SCHEDULE_VIEW, SCHEDULE_EDIT, PAYMENT_VIEW, PAYMENT_EDIT, ENQUIRIES_VIEW)
        const val CHANGED = "USER_ACCESS_CHANGED"
        const val LAST_ADMIN = "LAST_ADMIN_REQUIRED"
        const val ACCESS_SUFFIX = "/{id}/access"
    }
    object PasswordLifecycle {
        const val REQUIRED = "PASSWORD_CHANGE_REQUIRED"
        const val CHANGE_SUFFIX = "/change-password"
        const val TEMPORARY_SUFFIX = "/{id}/temporary-password"
        const val CHANGE_IP_LIMIT = 30
        const val CHANGE_ACCOUNT_LIMIT = 10
        const val STARTED_AT = "temporaryPasswordStartedAt"
        const val TEMPORARY_SECONDS = 86400L
        const val SESSION_SECONDS = 900L
        const val USERS = "/api/v1/admin/users"
        const val CHANGE = "/api/v1/auth/change-password"
        const val CURRENT_INVALID = "CURRENT_PASSWORD_INVALID"
        const val CONFIRM_MISMATCH = "PASSWORD_CONFIRM_MISMATCH"
        const val SAME_PASSWORD = "PASSWORD_UNCHANGED"
        const val LOGIN_CONFLICT = "LOGIN_CONFLICT"
        const val SELF_RESET = "SELF_PASSWORD_RESET_FORBIDDEN"
        const val CREATED = "USER_CREATED"
        const val RESET = "TEMPORARY_PASSWORD_ASSIGNED"
        const val CHANGED = "PASSWORD_CHANGED"
        const val FIRST_CHANGED = "TEMPORARY_PASSWORD_CHANGED"
    }

    object Editor {
        const val FIELD_TITLE = "FIELD_SESSION_TITLE"
        const val FIELD_START = "FIELD_SESSION_START"
        const val FIELD_END = "FIELD_SESSION_END"
        const val FIELD_CAPACITY = "FIELD_SESSION_CAPACITY"
        const val FIELD_AGE_RANGE = "FIELD_SESSION_AGE_RANGE"

        const val ROOT = "/api/v1/admin/sessions/{id}"
        const val DRAFT = "/draft"
        const val PUBLISH = "/draft/publish"
        const val HISTORY = "/history"
        const val RESTORE = "/history/{revisionId}/restore-draft"
        const val HISTORY_SIZE = 20
        const val SAVED = "SESSION_DRAFT_SAVED"
        const val DISCARDED = "SESSION_DRAFT_DISCARDED"
        const val PUBLISHED = "SESSION_DRAFT_PUBLISHED"
        const val RESTORED = "SESSION_DRAFT_RESTORED"
    }

    object Concept {
        val HTTP_SUCCESS = 200..299
        val HTTP_PERMANENT = 400..499
        const val MAX_REQUEST_BYTES = 16384
        const val RETRY_RATE = 3
        const val ENQUIRY_RATE = 10
        const val SESSION_SNAPSHOT = "enquiry.session"
        const val TELEGRAM_TEXT = "enquiry.telegram"
        const val ADMIN_DELIVERY = "/api/v1/admin/enquiries/{id}/delivery"
        const val PUSH_SUMMARY = "/api/v1/admin/enquiries/{id}/browser-push"
        const val PUSH_CONFIG = "/api/v1/admin/browser-push/config"
        const val PUSH_SUBSCRIPTIONS = "/api/v1/admin/browser-push/subscriptions"
        const val PUSH_SUBSCRIPTION_ID = "/api/v1/admin/browser-push/subscriptions/{id}"
        const val NOTIFICATION_SETTINGS = "/api/v1/admin/enquiry-notification-settings"
        const val MODE = "ADMIN_ENQUIRIES_V1"
        const val LOGIN_PATTERN = "[a-z0-9._-]{3,64}"
        const val LOCAL_GENERATION = "local-concept"
        const val ACCESS_GENERATION_SETTING = "lastochka.access-generation"
        const val MIN_GENERATION_LENGTH = 32
        const val ACCESS_GENERATION = "\${lastochka.access-generation:local-concept}"
        const val GENERATION_ATTRIBUTE = "conceptGeneration"
        const val ADMIN_ID_ENV = "LASTOCHKA_ADMIN_ID"
        const val ADMIN_LOGIN_ENV = "LASTOCHKA_ADMIN_LOGIN"
        const val PHONE_DIGITS = 11
        const val MAX_NAME = 100
        const val MAX_COMMENT = 1000
        const val MAX_PURPOSE = 300
        const val MAX_AGE = 17
        const val MAX_AGE_LONG = 17L
        const val MAX_MINOR = 99999999L
        const val PAGE_SIZE = 25
        const val REPLAY_SECONDS = 86400L
        const val LEGACY_REMOVED = "LEGACY_REMOVED"
        const val PAYMENT_PROVIDER_NOT_CONFIGURED = "PAYMENT_PROVIDER_NOT_CONFIGURED"
        const val FIELD_PHONE = "FIELD_PHONE"
        const val FIELD_AGE = "FIELD_AGE"
        const val FIELD_AMOUNT = "FIELD_AMOUNT"
        const val PENDING = "PENDING"
        const val RETRY_WAIT = "RETRY_WAIT"
        const val DELIVERED = "DELIVERED"
        const val FAILED = "FAILED"
        const val TRANSIENT = "TRANSIENT"
        const val REJECTED = "REJECTED"
        const val TELEGRAM_CHAT_MIGRATED = "CHAT_MIGRATED"
        const val DRAFT = "DRAFT"
        const val RUB = "RUB"
        const val PAYMENT_CREATED = "PAYMENT_CREATED"
        const val PAYMENT_UPDATED = "PAYMENT_UPDATED"
        const val DELIVERY_RETRY = "DELIVERY_RETRY"
        const val OPERATOR_RESET = "OPERATOR_RESET"
        const val LOGIN_MAX = 64
        const val MAX_ATTEMPTS = 8
        const val LEASE_SECONDS = 60L
        const val POLL_MILLIS = 5000L
        const val MAX_DELAY_SECONDS = 1800L
        const val INITIAL_DELAY_SECONDS = 10L
        const val REQUEST_TIMEOUT_SECONDS = 5L
        const val TELEGRAM_CONFIG = "lastochka.telegram"
        const val TELEGRAM_URL = "https://api.telegram.org"
        const val TELEGRAM_MESSAGE_LIMIT = 4096
        const val PUBLIC_ENQUIRIES = "/api/v1/enquiries"
        const val ADMIN_ENQUIRIES = "/api/v1/admin/enquiries"
        const val ADMIN_PAYMENTS = "/api/v1/admin/payment-requests"
        const val ADMIN_PAYMENT_ID = "/api/v1/admin/payment-requests/{id}"
        const val ADMIN_PAYMENT_ISSUE = "/api/v1/admin/payment-requests/{id}/issue"
        const val ADMIN_ENQUIRY_ID = "/api/v1/admin/enquiries/{id}"
        const val ADMIN_DELIVERY_RETRY = "/api/v1/admin/enquiries/{id}/delivery/retry"
        const val LEGACY_SESSION_PATH =
            "/api/v1/admin/sessions/[^/]+/(participants|move-preview|attendance-invitation)"
        val LEGACY_PREFIXES =
            listOf(
                "/api/v1/children",
                "/api/v1/bookings",
                "/api/v1/admin/bookings",
                "/api/v1/admin/families",
                "/api/v1/admin/moves",
                "/api/v1/admin/move-previews",
                "/api/v1/public/booking-confirmation",
                "/api/v1/auth/register",
                "/api/v1/auth/verify-email",
                "/api/v1/auth/resend-verification",
                "/api/v1/auth/forgot-password",
                "/api/v1/auth/reset-password",
            )
    }

    object Commands {
        const val SESSION_UPDATE_PREFIX = "session.update/"
        const val SESSION_ACTION_PREFIX = "session.action/"
        const val REPLAY_TTL_SECONDS = 86400L
        const val MAX_KEY_LENGTH = 100
        const val SESSION_CANCEL = "SESSION_CANCEL"
        const val SESSION_CLOSE = "SESSION_CLOSE"
        const val SESSION_CREATE = "session.create"
        const val SESSION_PUBLISH = "SESSION_PUBLISH"
        const val SESSION_REOPEN = "SESSION_REOPEN"
    }

    object BrowserPush {
        const val CONFIG = "lastochka.push"
        const val HOST_PATTERN = "[a-z0-9.-]+"
        const val MIN_ENDPOINT_LENGTH = 1
        const val MAX_ENDPOINT_LENGTH = 2048
        const val MAX_HOST_LENGTH = 253
        const val DEFAULT_URI_PORT = -1
        const val HTTPS_PORT = 443
        const val PUBLIC_KEY_BYTES = 65
        const val PUBLIC_KEY_PREFIX = 4
        const val AUTH_SECRET_BYTES = 16
        const val BITS_PER_BYTE = 8
        const val OUTBOX_TTL_SECONDS = 86400L
        const val PUSH_TTL_SECONDS = 3600
        const val REQUEST_TIMEOUT_MILLIS = 5000
        const val MAX_ATTEMPTS = 8
        const val SUBSCRIPTION_RATE = 10
        const val HTTP_GONE = 410
        const val HTTP_NOT_FOUND = 404
        const val POLL_MILLIS = 5000L
        const val LEASE_SECONDS = 60L
        const val MAX_DELAY_SECONDS = 1800L
        const val INITIAL_DELAY_SECONDS = 10L
        const val STATUS_NOT_SELECTED = "NOT_SELECTED"
        const val STATUS_CANCELLED = "CANCELLED"
        const val STATUS_ACCEPTED = "ACCEPTED"
        const val BIG_INTEGER_POSITIVE = 1
        val GLOBAL_IPV6 = "2000::/3"
        val RESTRICTED_RANGES =
            listOf(
                "0.0.0.0/8",
                "10.0.0.0/8",
                "100.64.0.0/10",
                "127.0.0.0/8",
                "169.254.0.0/16",
                "172.16.0.0/12",
                "192.0.0.0/24",
                "192.0.2.0/24",
                "192.88.99.0/24",
                "192.168.0.0/16",
                "198.18.0.0/15",
                "198.51.100.0/24",
                "203.0.113.0/24",
                "224.0.0.0/4",
                "240.0.0.0/4",
                "2001::/23",
                "2001:db8::/32",
                "2002::/16",
            )
    }

    object ErrorCodes {
        const val ACCESS_DENIED = "ACCESS_DENIED"
        const val AUTH_REQUIRED = "AUTH_REQUIRED"
        const val CALENDAR_RANGE_TOO_DENSE = "CALENDAR_RANGE_TOO_DENSE"
        const val CODE_PATTERN = "[A-Z][A-Z0-9_]{0,99}"
        const val DATA_CONFLICT = "DATA_CONFLICT"
        const val ENROLLMENT_REQUIRED = "ENROLLMENT_REQUIRED"
        const val ERROR_TITLE = "ERROR_TITLE"
        const val FIELD_EMAIL = "FIELD_EMAIL"
        const val FIELD_INVALID = "FIELD_INVALID"
        const val FIELD_LENGTH = "FIELD_LENGTH"
        const val FIELD_PATTERN = "[A-Za-z][A-Za-z0-9_.\\[\\]]{0,99}"
        const val FIELD_REQUIRED = "FIELD_REQUIRED"
        const val IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT"
        const val INTERNAL_ERROR = "INTERNAL_ERROR"
        const val INVALID_CHALLENGE = "INVALID_CHALLENGE"
        const val INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
        const val INVALID_IDEMPOTENCY_KEY = "INVALID_IDEMPOTENCY_KEY"
        const val INVALID_PAGE = "INVALID_PAGE"
        const val INVALID_RANGE = "INVALID_RANGE"
        const val INVALID_WEBAUTHN = "INVALID_WEBAUTHN"
        const val LAST_PASSKEY = "LAST_PASSKEY"
        const val METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
        const val NOT_FOUND = "NOT_FOUND"
        const val PASSWORD_DIGIT_REQUIRED = "PASSWORD_DIGIT_REQUIRED"
        const val PASSWORD_INVALID_CHARACTERS = "PASSWORD_INVALID_CHARACTERS"
        const val PASSWORD_LETTER_REQUIRED = "PASSWORD_LETTER_REQUIRED"
        const val PASSWORD_TOO_LONG = "PASSWORD_TOO_LONG"
        const val PASSWORD_TOO_SHORT = "PASSWORD_TOO_SHORT"
        const val RATE_LIMITED = "RATE_LIMITED"
        const val REASON_REQUIRED = "REASON_REQUIRED"
        const val REAUTH_REQUIRED = "REAUTH_REQUIRED"
        const val REQUEST_FAILED = "REQUEST_FAILED"
        const val SCHEDULE_CONFLICT = "SCHEDULE_CONFLICT"
        const val SESSION_UNAVAILABLE = "SESSION_UNAVAILABLE"
        const val VALIDATION_ERROR = "VALIDATION_ERROR"
        const val VERSION_CONFLICT = "VERSION_CONFLICT"
    }

    object Fields {
        const val PASSWORD = "password"
    }

    object Identity {
        const val ROLE_PREFIX = "ROLE_"
        const val RATE_LOGIN_IP_PREFIX = "login-ip:"
        const val RATE_LOGIN_PREFIX = "login:"
        const val ADMIN = "ADMIN"
        const val ANONYMOUS = "ANONYMOUS"
        const val ANONYMOUS_PRINCIPAL = "anonymousUser"
        const val AUTH_VERSION_ATTRIBUTE = "authVersion"
        const val CREATE = "CREATE"
        const val DOCTOR = "DOCTOR"
        const val FACTOR_PASSWORD = "FACTOR_PASSWORD"
        const val FACTOR_WEBAUTHN = "FACTOR_WEBAUTHN"
        const val FULL = "FULL"
        const val FULL_AT_ATTRIBUTE = "fullAt"
        const val GET = "GET"
        const val POST = "POST"
        const val PUT = "PUT"
        const val DELETE = "DELETE"
        const val PARENT = "PARENT"
        const val PASSWORD_AT_ATTRIBUTE = "passwordAt"
        const val RESET = "RESET"
        const val ROLE_ADMIN = "ROLE_ADMIN"
    }

    object Protocol {
        const val JSON = "application/json"
        const val CONTENT_TYPE = "Content-Type"
        const val CSRF_HEADER = "X-CSRF-TOKEN"
        const val IDEMPOTENCY_KEY = "Idempotency-Key"
        const val LASTOCHKA_ADMIN_NAME = "LASTOCHKA_ADMIN_NAME"
        const val LASTOCHKA_ADMIN_PASSWORD = "LASTOCHKA_ADMIN_PASSWORD"
        const val LASTOCHKA_SESSION = "LASTOCHKA_SESSION"
        const val PROBLEM_JSON = "application/problem+json"
        const val RETRY_AFTER = "Retry-After"
        const val SHA256 = "SHA-256"
    }

    object Scheduling {
        const val CANCEL = "CANCEL"
        const val CANCELLED = "CANCELLED"
        const val FORMAT_PATTERN = "GROUP|INDIVIDUAL"
        const val ACTION_PATTERN = "PUBLISH|CLOSE|REOPEN|CANCEL"
        const val CLOSE = "CLOSE"
        const val CLOSED = "CLOSED"
        const val DRAFT = "DRAFT"
        const val GROUP = "GROUP"
        const val INDIVIDUAL = "INDIVIDUAL"
        const val OPEN = "OPEN"
        const val PUBLISH = "PUBLISH"
        const val REOPEN = "REOPEN"
        const val SESSION_CANCELLED = "SESSION_CANCELLED"
        const val SESSION_CREATED = "SESSION_CREATED"
        const val SESSION_MOVED = "SESSION_MOVED"
        const val SESSION_UPDATED = "SESSION_UPDATED"
    }

    object Time {
        const val STUDIO_ZONE = "Europe/Moscow"
    }

    object Password {
        const val CONSTRAINT_MESSAGE = "{PASSWORD_INVALID}"
        const val MIN_CODE_POINTS = 6
        const val MAX_CODE_POINTS = 128
    }

    object IdentityLimits {
        const val LOGIN_IP = 60
        const val LOGIN_ACCOUNT = 10
        const val MAIL_IP = 20
        const val MAIL_ACCOUNT = 5
        const val RATE_WINDOW_SECONDS = 900L
        const val MAX_RATE_WINDOW_SECONDS = 86400L
        const val MAX_CHALLENGE_BYTES = 262144
        const val RECENT_PASSWORD_SECONDS = 300L
        const val CHALLENGE_TTL_SECONDS = 300L
        const val MAX_BUCKET_LENGTH = 300
    }

    object SchedulingLimits {
        const val MAX_SEARCH_DAYS = 93L
        const val MAX_CALENDAR_DAYS = 7L
        const val MAX_CALENDAR_SESSIONS = 1000
    }

    object Limits {
        const val PAGE_SIZE_MAX = 100
        const val MAX_NAME_LENGTH = 120
        const val MAX_REASON_LENGTH = 500
    }

    object Http {
        const val BAD_REQUEST = 400
        const val UNAUTHORIZED = 401
        const val FORBIDDEN = 403
        const val NOT_FOUND = 404
        const val METHOD_NOT_ALLOWED = 405
        const val CONFLICT = 409
        const val TOO_MANY_REQUESTS = 429
        const val INTERNAL_ERROR = 500
        const val UNAVAILABLE = 503
    }

    object UserTexts {
        const val KEY_RENAMED = "KEY_RENAMED"
        const val KEY_REVOKED = "KEY_REVOKED"
        const val SIGNED_OUT = "SIGNED_OUT"
        const val KEY_ADDED = "KEY_ADDED"
        const val SESSION_CANCELLED = "SESSION_CANCELLED"
        const val SESSION_MOVED = "SESSION_MOVED"
    }

    object Routes {
        const val API_V1 = "/api/v1"
        const val LASTOCHKA = "/lastochka"
        const val API_V1_PUBLIC = "/api/v1/public/"
        const val API_V1_SESSIONS = "/api/v1/sessions"
        const val API_V1_AUTH = "/api/v1/auth"
        const val API_V1_AUTH_WEBAUTHN = "/api/v1/auth/webauthn"
        const val API_V1_PUBLIC_ANY = "/api/v1/public/**"
        const val API_V1_SESSIONS_ANY = "/api/v1/sessions/**"
        const val ACTUATOR_HEALTH_ANY = "/actuator/health/**"
        const val V3_API_DOCS_ANY = "/v3/api-docs/**"
        const val SWAGGER_UI_ANY = "/swagger-ui/**"
        const val SWAGGER_UI_HTML = "/swagger-ui.html"
        const val ERROR = "/error"
        const val API_V1_AUTH_WEBAUTHN_ANY = "/api/v1/auth/webauthn/**"
        const val API_V1_AUTH_ANY = "/api/v1/auth/**"
        const val API_V1_ADMIN_ANY = "/api/v1/admin/**"
        const val API_V1_ANY = "/api/v1/**"
        const val CSRF = "/csrf"
        const val ME = "/me"
        const val PASSWORD_STAGE = "/password-stage"
        const val LOGOUT = "/logout"
        const val REGISTRATION_OPTIONS = "/registration/options"
        const val REGISTRATION_FINISH = "/registration/finish"
        const val AUTHENTICATION_OPTIONS = "/authentication/options"
        const val AUTHENTICATION_FINISH = "/authentication/finish"
        const val CREDENTIALS = "/credentials"
        const val CREDENTIALS_ID = "/credentials/{id}"
        const val SESSIONS = "/sessions"
        const val SESSIONS_ID = "/sessions/{id}"
        const val ADMIN_SESSIONS = "/admin/sessions"
        const val ADMIN_CALENDAR = "/admin/calendar"
        const val ADMIN_SESSIONS_ID = "/admin/sessions/{id}"
        const val ADMIN_SESSIONS_ID_ACTIONS = "/admin/sessions/{id}/actions"
        const val API_V1_PUBLIC_LANDING = "/api/v1/public/landing"
    }

    object Configuration {
        const val SECURITY_PREFIX = "lastochka.security"
        const val LASTOCHKA_RP_ID = "\${lastochka.rp-id}"
        const val LASTOCHKA_ORIGIN = "\${lastochka.origin}"
        const val WORKERS_ENABLED = "lastochka.workers.enabled"
        const val LASTOCHKA_SECURITY_RATE_WINDOW_SECONDS =
            "\${lastochka.security.rate-window-seconds:900}"
    }

    object Content {
        const val BLOCK_ID_PATTERN = "[a-z][a-z0-9-]{0,63}"
        const val IMAGE_FILE_PATTERN = "[A-Za-z0-9_-]+\\.(webp|jpg|png)"
        const val TELEGRAM_PATTERN = "[A-Za-z0-9_]{5,32}"
    }

    object Recurrence {
        const val ID = "/{id}"
        const val HISTORY = "/{id}/history"
        const val CALENDAR = "/calendar"
        const val PREVIEW = "/preview"
        const val NEW_GROUP = "/new-group"
        const val NEW_GROUP_PREVIEW = "/new-group/preview"
        const val PREVIEW_GROUP_ID = "00000000-0000-0000-0000-000000000000"
        const val EXISTING_PREVIEW = "/{id}/preview"
        const val DRAFT = "/{id}/draft"
        const val PUBLISH = "/{id}/publish"
        const val DEFAULT_CAPACITY = 8
        const val LAST_WEEKDAY = 7
        const val SECONDS_PER_MINUTE = 60L
        const val VALIDATION_DELAY_SECONDS = 60L
        const val VALIDATION_END_SECONDS = 120L
        const val GROUPS = "/api/v1/admin/schedule-groups"
        const val SERIES = "/api/v1/admin/session-series"
        const val MAX_DAYS = 366L
        const val MAX_OCCURRENCES = 200
        const val CREATE = "CREATE"
        const val CHANGE = "CHANGE"
        const val CANCEL = "CANCEL"
        const val KEEP = "KEEP"
        const val INVALID_RULE = "INVALID_SERIES_RULE"
        const val DRAFT_CONFLICT = "SERIES_DRAFT_CONFLICT"
        const val PLAN_STALE = "SERIES_PLAN_STALE"
        const val START_PASSED = "SERIES_START_PASSED"
        const val BEFORE_CURRENT_WEEK = "SERIES_BEFORE_CURRENT_WEEK"
        const val GROUP_SAVED = "GROUP_SAVED"
        const val DRAFT_SAVED = "SERIES_DRAFT_SAVED"
        const val DRAFT_DISCARDED = "SERIES_DRAFT_DISCARDED"
        const val PUBLISHED = "SERIES_PUBLISHED"
        const val PARAMETER_CONFLICT = "SERIES_ITEM_DRAFT"
        const val RESOURCE_CONFLICT = "SCHEDULE_CONFLICT"
    }
}
