# Stage 1: Build the application
FROM node:22-alpine AS builder

WORKDIR /usr/app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code and tsconfig
COPY tsconfig.json ./
COPY src ./src

# Build the TypeScript project
RUN npm run build

# Stage 2: Production image
FROM node:22-alpine

WORKDIR /usr/app

# Copy only necessary production artifacts
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts # Install prod dependencies again, skip scripts

COPY --from=builder /usr/app/dist ./dist

EXPOSE 53

# Command to run the application
CMD ["node", "dist/server.js"]
