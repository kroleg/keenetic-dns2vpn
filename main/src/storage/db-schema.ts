import { sqliteTable, text, integer, blob } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const servicesTable = sqliteTable('services', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  interfaces: text('interfaces', { mode: 'json' }).$type<string[]>().notNull(),
  matchingDomains: text('matching_domains', { mode: 'json' }).$type<string[]>().notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`)
  // commented out as it doesn't work
  // .$onUpdate(() => sql`(strftime('%s', 'now'))`).notNull(),
});
