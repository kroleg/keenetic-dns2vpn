import { db } from './db.js';
import { servicesTable } from './db-schema.js';
import { eq, type InferSelectModel, type InferInsertModel } from 'drizzle-orm';

// Type for a selected service (matches the database record)
export type Service = InferSelectModel<typeof servicesTable>;

// Type for inserting a new service
export type NewService = InferInsertModel<typeof servicesTable>;

// Type for updating a service (e.g., all fields optional except id, or a specific subset)
// For now, let's make it a partial of NewService, but without the id, as id is usually not updatable directly or used in the WHERE clause.
// Also excluding createdAt and updatedAt as they are auto-managed by the database.
export type UpdateService = Partial<Omit<NewService, 'id' | 'createdAt' | 'updatedAt'>>;


export async function createService(data: NewService): Promise<Service> {
  const [newService] = await db.insert(servicesTable).values(data).returning();
  return newService;
}

export async function getServiceByName(name: string): Promise<Service | null> {
  const [service] = await db.select().from(servicesTable).where(eq(servicesTable.name, name)).limit(1);
  return service || null;
}

export async function getServiceById(id: number): Promise<Service | null> {
  const [service] = await db.select().from(servicesTable).where(eq(servicesTable.id, id)).limit(1);
  return service || null;
}

export async function getAllServices(): Promise<Service[]> {
  const services = await db.select().from(servicesTable);
  return services;
}

export async function updateService(id: number, data: UpdateService): Promise<Service | null> {
  // Ensure there's data to update to prevent an empty update call
  if (Object.keys(data).length === 0) {
    return getServiceById(id); // Or throw an error, or return null based on desired behavior
  }
  const [updatedService] = await db.update(servicesTable)
    .set(data)
    .where(eq(servicesTable.id, id))
    .returning();
  return updatedService || null;
}

export async function deleteService(id: number): Promise<boolean> {
  const result = await db.delete(servicesTable).where(eq(servicesTable.id, id)).returning({ id: servicesTable.id });
  return result.length > 0;
}
