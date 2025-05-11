import { runMigrations } from '../src/storage/db';

console.log('Attempting to run database migrations...');
try {
  await runMigrations();
  console.log('Database migrations completed successfully.');
  console.log('The sqlite.db file should now be created/updated in the js-api directory.');
} catch (error) {
  console.error('Failed to apply database migrations:', error);
  process.exit(1);
}
