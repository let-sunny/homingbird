# syntax=docker/dockerfile:1

FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-slim AS drivers
WORKDIR /drivers
RUN npm install --omit=dev --no-audit --no-fund pg@8 mysql2@3

FROM node:22-slim
ENV NODE_ENV=production \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    HB_PORT=8080 \
    HB_WEB_DIR=/app/web \
    HB_DATABASE_URL=sqlite:/data/dovecote.sqlite
WORKDIR /app
COPY --from=drivers /drivers/node_modules ./node_modules
COPY --from=build /repo/packages/dovecote/dist/dovecote.mjs ./dovecote.mjs
COPY --from=build /repo/packages/pwa/dist ./web
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.HB_PORT + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "dovecote.mjs"]
