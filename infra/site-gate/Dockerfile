FROM node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8

WORKDIR /app
COPY infra/site-gate/gate.mjs infra/site-gate/placeholder.html ./
COPY frontend/public/images/logo-turquoise.svg ./logo.svg
USER 10001:10001
ENV GATE_PLACEHOLDER_FILE=/app/placeholder.html GATE_LOGO_FILE=/app/logo.svg PORT=3001
EXPOSE 3001
CMD ["node", "/app/gate.mjs"]
