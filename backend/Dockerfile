FROM node:24-bookworm-slim AS dependencies

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci

FROM dependencies AS build
COPY backend ./backend
RUN DATABASE_URL=postgresql://cinema:cinema_dev@127.0.0.1:5432/cinema?schema=public npm run build --workspace @cinema-booking/backend

# This target keeps Prisma CLI and the seed runner for one-shot maintenance jobs.
FROM build AS migration
CMD ["npm", "run", "db:deploy", "--workspace", "@cinema-booking/backend"]

FROM build AS runtime
RUN npm prune --omit=dev --ignore-scripts
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
ENV NODE_ENV=production \
    PORT=4000
EXPOSE 4000
USER node
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start", "--workspace", "@cinema-booking/backend"]
