import { pgTable, serial, text, boolean, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const servicesTable = pgTable('services', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  interfaces: jsonb('interfaces').$type<string[]>().notNull(),
  matchingDomains: jsonb('matching_domains').$type<string[]>().notNull(),
  optimizeRoutes: boolean('optimize_routes').notNull().default(true),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
}, (table) => {
  return {
    nameIdx: index('services_name_idx').on(table.name),
  };
});
