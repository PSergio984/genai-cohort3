# Multi-stage: TypeScript compiles inside the image because dist/ is never
# committed (git-ignored) and excluded from the build context (.dockerignore).
FROM node:22-slim AS build
WORKDIR /srv
COPY app/package.json app/package-lock.json ./app/
RUN npm ci --prefix ./app
COPY app/tsconfig.json ./app/
COPY app/src ./app/src
# React+Vite frontend: built here so the image never depends on host output.
# Firebase web config rides build args (public identifiers, but scanner-hostile:
# never default them here). Local docker builds and CD pass --set-build-env-vars
# / --build-arg from repo Variables (see cmd.md section 4); app/client/.env
# covers `npm run build` outside Docker.
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY
ENV VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN
ENV VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID
ENV VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID
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
