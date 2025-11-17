import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/storage/db-schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER || 'dns2vpn',
    password: process.env.POSTGRES_PASSWORD || 'dns2vpn',
    database: process.env.POSTGRES_DB || 'dns2vpn',
  },
});
