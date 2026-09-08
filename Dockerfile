# Production Dockerfile for Render / VPS Deployment with Playwright & WhatsApp Web Support
FROM mcr.microsoft.com/playwright:v1.50.1-noble

# Set working directory
WORKDIR /app

# Set Playwright paths
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install ALL dependencies (including devDependencies like TypeScript)
RUN npm ci --include=dev

# Generate Prisma Client
RUN npx prisma generate

# Copy source code and config
COPY tsconfig.json ./
COPY src ./src

# Compile TypeScript
RUN npm run build

# Remove devDependencies to keep image lean
RUN npm prune --production

# Create data and logs directories
RUN mkdir -p /app/data/whatsapp_session /app/logs

# Set production environment variables for runtime
ENV NODE_ENV=production
ENV PORT=3000

# Expose port for Render health checks
EXPOSE 3000

# Start application daemon
CMD ["node", "dist/app.js"]
