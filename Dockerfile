# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /workspace
RUN npm install --global pnpm@10.33.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm -r build && pnpm --filter @agenda/api deploy --legacy --prod /out/api

FROM node:22-bookworm-slim AS backend
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app/apps/api
COPY --from=build --chown=node:node /out/api ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]

FROM nginx:1.28-alpine AS frontend
COPY deploy/frontend.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 80
