# ── Build stage: install production deps ──────────────────────────────────────
FROM node:20-slim AS deps
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --production --no-audit --no-fund && npm cache clean --force

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /usr/src/app

# Copy installed modules from build stage (keeps final image lean)
COPY --from=deps /usr/src/app/node_modules ./node_modules

# Copy application source
COPY . .

# Cloud Run requires the app to bind on PORT (default 8080)
ENV PORT=8080
ENV NODE_ENV=production

# Expose for documentation; Cloud Run uses PORT env var
EXPOSE 8080

# Use node directly (avoids npm overhead; better signal handling)
CMD [ "node", "server.js" ]
