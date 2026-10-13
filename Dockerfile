FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY assets/app-template/public ./assets/app-template/public
COPY assets/selfhosted ./assets/selfhosted
ENV SHARED_TRIP_HOST=0.0.0.0 SHARED_TRIP_PORT=4173 SHARED_TRIP_DATA_DIR=/data
USER node
EXPOSE 4173
CMD ["node","server/index.mjs"]
