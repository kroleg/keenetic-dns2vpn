import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './db-schema.js';

const { Pool } = pg;

// PostgreSQL configuration from environment variables
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'dns2vpn',
  user: process.env.POSTGRES_USER || 'dns2vpn',
  password: process.env.POSTGRES_PASSWORD || 'dns2vpn',
});

export const db = drizzle(pool, { schema });

// Function to run migrations
export async function runMigrations() {
  // This command run all migrations from the specified directory
  // and apply them to the database
  await migrate(db, { migrationsFolder: './migrations' });
  console.log('Migrations run successfully');
}

// Graceful shutdown
export async function closeDatabase() {
  await pool.end();
  console.log('Database connection closed');
}
