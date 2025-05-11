import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './db-schema.js';

const dbPath = process.env.DB_PATH || 'sqlite.db';

const sqlite = new Database(dbPath);

export const db = drizzle(sqlite, { schema });

// Function to run migrations
export async function runMigrations() {
  // This command run all migrations from the specified directory
  // and apply them to the database
  await migrate(db, { migrationsFolder: './migrations' });
  console.log('Migrations run successfully');
}

// Optionally, run migrations on startup (consider if this is appropriate for your application flow)
// For a library, it might be better to export the function and let the consumer decide when to run it.
// runMigrations().catch(console.error);
