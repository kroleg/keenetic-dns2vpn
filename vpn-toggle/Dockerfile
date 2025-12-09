FROM node:24-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code and config
COPY src ./src
COPY tsconfig.json ./

# Build the application
RUN pnpm run build

# Expose port
EXPOSE 3002

# Start the application
CMD ["node", "dist/server.js"]
