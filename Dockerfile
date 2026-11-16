FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-slim

WORKDIR /app

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist/mcp/standalone-gateway.js ./dist/mcp/standalone-gateway.js

ENTRYPOINT ["node", "dist/mcp/standalone-gateway.js"]
