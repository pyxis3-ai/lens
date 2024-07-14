FROM oven/bun:alpine AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install
COPY . .
RUN bun run build

FROM oven/bun:alpine
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --production
COPY server/ server/
COPY --from=build /app/dist dist/
EXPOSE 3002
CMD ["bun", "run", "server/index.ts"]
