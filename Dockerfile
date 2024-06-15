FROM oven/bun:alpine
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production
COPY server/ ./server/
EXPOSE 3002
CMD ["bun", "run", "server/index.ts"]
