# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS manifests
WORKDIR /app
COPY .npmrc package.json package-lock.json ./
COPY packages/api/package.json packages/api/package.json
COPY packages/app/package.json packages/app/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/google/package.json packages/google/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/solidtime/package.json packages/solidtime/package.json
COPY packages/web/package.json packages/web/package.json
# @kurotch-homelab packages come from GitHub Packages, which needs a read:packages token even
# for public packages. Pass a user .npmrc with the token as the build secret "npmrc".

FROM manifests AS build
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc,required=true npm ci
COPY tsconfig*.json ./
COPY packages/ packages/
RUN npm run build --workspace=@fpm/web \
    && npm run build --workspace=@fpm/server

FROM manifests AS production-dependencies
# Only install the server workspace's production dependency tree.
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc,required=true npm ci --omit=dev --workspace=@fpm/server --include-workspace-root=false \
    && rm -rf node_modules/@fpm
# @fpm sources are bundled into dist/main.js; workspace symlinks are not needed.

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DB_KIND=sqlite \
    SQLITE_PATH=/data/fpm.sqlite \
    STATIC_DIR=/app/web/dist
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/packages/server/package.json ./package.json
COPY --from=build /app/packages/server/dist ./dist
COPY --from=build /app/packages/web/dist ./web/dist
# The named volume inherits this ownership on its first mount.
RUN mkdir /data && chown node:node /data \
    && node --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(':memory:'); db.close();"
USER 1000:1000
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["node", "--input-type=module", "-e", "try { const r = await fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health', { signal: AbortSignal.timeout(4000) }); process.exit(r.status === 200 ? 0 : 1); } catch { process.exit(1); }"]
CMD ["node", "dist/main.js"]
