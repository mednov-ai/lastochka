ARG JRE_IMAGE=eclipse-temurin:25-jre@sha256:ecdc0adb37bde1a281c4d245a3cd535004b1fc8322d560f5b09463b248c81df0
FROM ${JRE_IMAGE}
WORKDIR /app
ARG APP_VERSION=0.1.0
LABEL org.opencontainers.image.version=${APP_VERSION}
LABEL org.lastochka.concept="ADMIN_ENQUIRIES_V1"
COPY backend/app/build/libs/app-0.1.0.jar /app/app.jar
COPY infra/backend/healthcheck.sh /app/healthcheck.sh
ENV BIND_ADDRESS=0.0.0.0
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=65.0"
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java","-jar","/app/app.jar"]

LABEL org.lastochka.schema.min="21" org.lastochka.schema.max="21"
LABEL org.lastochka.alfa-test-payments="ALFA_TEST_PAYMENTS_V1"
LABEL org.lastochka.staff-permissions="STAFF_PERMISSIONS_V1"

LABEL org.lastochka.password-lifecycle="PASSWORD_LIFECYCLE_V1"

LABEL org.lastochka.recurring-groups="RECURRING_GROUPS_V1"

LABEL org.lastochka.enquiry-notifications="ENQUIRY_MULTICHANNEL_V1"

LABEL org.lastochka.inline-recurrence="INLINE_RECURRENCE_V1"
LABEL org.lastochka.session-corrections="SESSION_CORRECTIONS_V1"
