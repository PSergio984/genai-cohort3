# Multi-stage: TypeScript compiles inside the image because dist/ is never
# committed (git-ignored) and excluded from the build context (.dockerignore).
FROM node:22-slim AS build
WORKDIR /srv
COPY app/package.json app/package-lock.json ./app/
RUN npm ci --prefix ./app
COPY app/tsconfig.json ./app/
COPY app/src ./app/src
WORKDIR /srv/app
RUN npm run build

FROM node:22-slim
WORKDIR /srv
COPY --from=build /srv/app/package.json /srv/app/package-lock.json ./app/
RUN npm ci --omit=dev --prefix ./app
COPY --from=build /srv/app/dist ./app/dist
# Static frontend (no build step): served by express.static from app/public.
COPY app/public ./app/public
ENV PORT=8080
EXPOSE 8080
CMD ["node", "app/dist/main.js"]
