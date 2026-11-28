ARG JRE_IMAGE=eclipse-temurin:25-jre@sha256:ecdc0adb37bde1a281c4d245a3cd535004b1fc8322d560f5b09463b248c81df0
FROM ${JRE_IMAGE}
WORKDIR /app
ARG APP_VERSION=0.1.0
LABEL org.opencontainers.image.version=${APP_VERSION}
LABEL org.lastochka.concept="ADMIN_ENQUIRIES_V1"
COPY backend/app/build/libs/app-0.1.0.jar /app/app.jar
COPY infra/backend/healthcheck.sh /app/healthcheck.sh
USER root
RUN rm -rf /app/extracted && mkdir /app/extracted && chown 10001:10001 /app/extracted
ENV BIND_ADDRESS=0.0.0.0
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=65.0"
USER 10001:10001
RUN java -Djarmode=tools -jar /app/app.jar extract --destination /app/extracted
EXPOSE 8080
ENTRYPOINT ["java","-jar","/app/extracted/app.jar"]

LABEL org.lastochka.schema.min="35" org.lastochka.schema.max="35"
LABEL org.lastochka.permanent-schedule="WEEKLY_INTERVALS_V1"
LABEL org.lastochka.open-ended-age="OPEN_ENDED_AGE_V1"
LABEL org.lastochka.alfa-test-payments="ALFA_TEST_PAYMENTS_V1"
LABEL org.lastochka.alfa-dual-gateway="ALFA_DUAL_GATEWAY_V1"
LABEL org.lastochka.staff-permissions="STAFF_PERMISSIONS_V1"

LABEL org.lastochka.password-lifecycle="PASSWORD_LIFECYCLE_V1"


LABEL org.lastochka.enquiry-notifications="VK_ENQUIRY_NOTIFICATIONS_V1"

LABEL org.lastochka.enquiry-age-direction="ENQUIRY_AGE_DIRECTION_V1"
