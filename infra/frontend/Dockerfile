ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --omit=dev --omit=peer --ignore-scripts \
    && rm -rf node_modules/typescript node_modules/.bin/tsc node_modules/.bin/tsserver
FROM ${NODE_IMAGE}
WORKDIR /app
ARG APP_VERSION=0.1.0
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.version=${APP_VERSION}
LABEL org.lastochka.concept="ADMIN_ENQUIRIES_V1"
ENV NODE_ENV=production BIND_ADDRESS=0.0.0.0 PORT=3000 ASSET_ARCHIVE_DIR=/app/public-assets
COPY --from=dependencies /app/node_modules ./node_modules
COPY frontend/package.json frontend/server.mjs frontend/base-path.mjs ./
COPY frontend/build ./build
RUN mkdir -p /app/public-assets/assets && chown -R node:node /app/public-assets \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
USER node
EXPOSE 3000
CMD ["node","server.mjs"]

LABEL org.lastochka.schema.min="21" org.lastochka.schema.max="21"
LABEL org.lastochka.alfa-test-payments="ALFA_TEST_PAYMENTS_V1"
LABEL org.lastochka.staff-permissions="STAFF_PERMISSIONS_V1"

LABEL org.lastochka.password-lifecycle="PASSWORD_LIFECYCLE_V1"

LABEL org.lastochka.recurring-groups="RECURRING_GROUPS_V1"

LABEL org.lastochka.enquiry-notifications="ENQUIRY_MULTICHANNEL_V1"

LABEL org.lastochka.inline-recurrence="INLINE_RECURRENCE_V1"
LABEL org.lastochka.session-corrections="SESSION_CORRECTIONS_V1"
