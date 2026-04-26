# Builder service for Petal — runs npm install + vite build + wrangler pages deploy
# per project generation. Designed for Railway's free Node tier.

FROM node:20-slim

# Wrangler needs git for some operations; install minimal tools.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install builder deps first (cached layer).
COPY package.json ./
RUN npm install --omit=dev

# Compile TypeScript.
COPY tsconfig.json ./
COPY src ./src
RUN npm install typescript --no-save && npx tsc -p tsconfig.json

# Persistent npm cache across container restarts to speed up project installs.
ENV NPM_CONFIG_CACHE=/app/.npm-cache
RUN mkdir -p /app/.npm-cache /app/builds

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/server.js"]
