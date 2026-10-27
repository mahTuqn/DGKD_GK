FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci

COPY frontend ./frontend
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build --workspace @cinemabooking/frontend

FROM nginx:alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --retries=12 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
