# Use official Bun image
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS install
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

# Production image
FROM base AS release
COPY --from=install /app/node_modules ./node_modules
COPY . .

# Set environment variables
ENV NODE_ENV=production
ENV PORT=7860

# Expose port
EXPOSE 7860

# Run the app
CMD ["bun", "run", "start"]
