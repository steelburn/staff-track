# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# ---- Production stage ----
FROM node:20-alpine AS production
ENV NODE_ENV=production

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder /build/node_modules ./node_modules

# Copy source
COPY package.json ./
COPY src/ ./src/

# Ensure data directory exists and is writable
RUN mkdir -p /data && chown appuser:appgroup /data

USER appuser

EXPOSE 3000

CMD ["node", "src/index.js"]
