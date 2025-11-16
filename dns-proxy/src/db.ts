import pg from 'pg';
import type { Logger } from 'winston';

const { Pool } = pg;

export interface DnsRequestRecord {
  id?: number;
  client_ip: string;
  hostname: string;
  query_type: string;
  status: 'pending' | 'resolved' | 'failed';
  resolved_ips?: string[];
  error_message?: string;
  response_time_ms?: number;
  created_at?: Date;
  updated_at?: Date;
}

export class DnsRequestLogger {
  private pool: pg.Pool;
  private logger: Logger;
  private initialized: boolean = false;

  constructor(logger: Logger) {
    this.logger = logger;

    const config = {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'dns2vpn',
      user: process.env.POSTGRES_USER || 'dns2vpn',
      password: process.env.POSTGRES_PASSWORD || 'dns2vpn',
    };

    this.pool = new Pool(config);

    this.pool.on('error', (err) => {
      this.logger.error('Unexpected error on idle PostgreSQL client', err);
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.createTableIfNotExists();
      this.initialized = true;
      this.logger.info('DNS request logger initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize DNS request logger:', error);
      throw error;
    }
  }

  private async createTableIfNotExists(): Promise<void> {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS dns_requests (
        id SERIAL PRIMARY KEY,
        client_ip VARCHAR(45) NOT NULL,
        hostname VARCHAR(255) NOT NULL,
        query_type VARCHAR(10) NOT NULL DEFAULT 'A',
        status VARCHAR(20) NOT NULL,
        resolved_ips JSONB,
        error_message TEXT,
        response_time_ms INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    const createIndexQuery = `
      CREATE INDEX IF NOT EXISTS idx_dns_requests_client_ip ON dns_requests(client_ip);
      CREATE INDEX IF NOT EXISTS idx_dns_requests_hostname ON dns_requests(hostname);
      CREATE INDEX IF NOT EXISTS idx_dns_requests_status ON dns_requests(status);
      CREATE INDEX IF NOT EXISTS idx_dns_requests_created_at ON dns_requests(created_at);
    `;

    await this.pool.query(createTableQuery);
    await this.pool.query(createIndexQuery);
  }

  async logPendingRequest(clientIp: string, hostname: string, queryType: string = 'A'): Promise<number> {
    if (!this.initialized) {
      this.logger.warn('DNS request logger not initialized, skipping log');
      return -1;
    }

    try {
      const result = await this.pool.query<{ id: number }>(
        `INSERT INTO dns_requests (client_ip, hostname, query_type, status)
         VALUES ($1, $2, $3, 'pending')
         RETURNING id`,
        [clientIp, hostname, queryType]
      );
      return result.rows[0].id;
    } catch (error) {
      this.logger.error('Error logging pending DNS request:', error);
      return -1;
    }
  }

  async updateResolved(id: number, resolvedIps: string[], responseTimeMs: number): Promise<void> {
    if (!this.initialized || id < 0) {
      return;
    }

    try {
      await this.pool.query(
        `UPDATE dns_requests
         SET status = 'resolved',
             resolved_ips = $1,
             response_time_ms = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [JSON.stringify(resolvedIps), responseTimeMs, id]
      );
    } catch (error) {
      this.logger.error('Error updating resolved DNS request:', error);
    }
  }

  async updateFailed(id: number, errorMessage: string, responseTimeMs: number): Promise<void> {
    if (!this.initialized || id < 0) {
      return;
    }

    try {
      await this.pool.query(
        `UPDATE dns_requests
         SET status = 'failed',
             error_message = $1,
             response_time_ms = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [errorMessage, responseTimeMs, id]
      );
    } catch (error) {
      this.logger.error('Error updating failed DNS request:', error);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
    this.logger.info('DNS request logger closed');
  }
}
