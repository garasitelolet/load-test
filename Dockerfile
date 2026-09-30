FROM grafana/k6:latest AS k6
FROM oven/bun:1-slim

WORKDIR /app

COPY --from=k6 /usr/bin/k6 /usr/local/bin/k6
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile
COPY server.ts ./server.ts
COPY tests ./tests
COPY web ./web
COPY reports ./reports

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000
VOLUME ["/app/reports"]

CMD ["bun", "run", "server.ts"]