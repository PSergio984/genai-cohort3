# Multi-stage: TypeScript compiles inside the image because dist/ is never
# committed (git-ignored) and excluded from the build context (.dockerignore).
FROM node:22-slim AS build
WORKDIR /srv
COPY app/package.json app/package-lock.json ./app/
RUN npm ci --prefix ./app
COPY app/tsconfig.json ./app/
COPY app/src ./app/src
# React+Vite frontend: built here so the image never depends on host output.
# (No build args: the browser reads Firebase web config at runtime from the
# server-rendered /firebase-config.js route, fed by container env.)
COPY app/client/package.json app/client/package-lock.json ./app/client/
RUN npm ci --prefix ./app/client
COPY app/client/index.html app/client/tsconfig.json app/client/vite.config.ts ./app/client/
COPY app/client/src ./app/client/src
WORKDIR /srv/app/client
RUN npm run build
WORKDIR /srv/app
RUN npm run build

FROM node:22-slim
WORKDIR /srv
COPY --from=build /srv/app/package.json /srv/app/package-lock.json ./app/
RUN npm ci --omit=dev --prefix ./app
COPY --from=build /srv/app/dist ./app/dist
# Static frontend (Vite build output): served by express.static from app/public.
COPY --from=build /srv/app/public ./app/public
ENV PORT=8080
EXPOSE 8080
CMD ["node", "app/dist/main.js"]
