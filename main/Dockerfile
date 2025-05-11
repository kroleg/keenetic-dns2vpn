# Stage 1: Build the application
FROM node:22-slim AS builder

WORKDIR /usr/app

# Install pnpm
RUN npm install -g pnpm@10

# Install dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install

# Copy source code and tsconfig
COPY tsconfig.json ./
COPY src ./src

RUN pnpm run build

# Remove dev dependencies
RUN pnpm install --prod

# Stage 2: Production image
FROM node:22-slim

WORKDIR /usr/app

COPY --from=builder /usr/app/node_modules ./node_modules
COPY --from=builder /usr/app/dist ./dist
COPY migrations ./migrations

# Command to run the application
CMD ["node", "dist/main.js"]
