# Builder service for Petal — runs npm install + vite build + wrangler pages deploy
# per project generation. Designed for Railway's free Node tier.

FROM node:20-slim

# Wrangler needs git; the /exec sandbox needs ripgrep + python3 for the
# inspection and codemod tool surface (see src/exec.ts allowlist).
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates ripgrep python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install builder deps first (cached layer).
COPY package.json ./
RUN npm install --omit=dev

# Chromium + its system libs for the post-deploy verifier (src/verify.ts).
# Installed after npm install so the playwright package version and the browser
# revision it expects always match.
RUN npx playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/*

# Compile TypeScript.
COPY tsconfig.json ./
COPY src ./src
# Bundled generation pipeline (scripts/build-agent-core.mjs), used when AGENT_IN_PROCESS=1.
COPY vendor ./vendor
RUN npm install typescript --no-save && npx tsc -p tsconfig.json

# Persistent npm cache across container restarts to speed up project installs.
ENV NPM_CONFIG_CACHE=/app/.npm-cache
RUN mkdir -p /app/.npm-cache /app/builds

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/server.js"]
