FROM oven/bun:alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:alpine
WORKDIR /app
COPY server/ server/
COPY --from=build /app/dist dist/
EXPOSE 3002
CMD ["bun", "run", "server/index.ts"]
