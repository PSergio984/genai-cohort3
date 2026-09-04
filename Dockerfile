FROM node:22-slim
WORKDIR /srv
COPY app/package.json app/package-lock.json ./app/
RUN npm ci --omit=dev --prefix ./app
COPY app/dist ./app/dist
ENV PORT=8080
EXPOSE 8080
CMD ["node", "app/dist/main.js"]
