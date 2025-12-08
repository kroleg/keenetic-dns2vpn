import express, { type Request, type Response, type NextFunction } from 'express';
import type { Logger } from 'winston';
import pg from 'pg';

const { Pool } = pg;

// Parse time delta strings like "7d", "1w", "24h", "30m"
function parseDelta(delta: string): Date | null {
  const match = delta.match(/^(\d+)([mhdw])$/);
  if (!match) return null;

  const value = parseInt(match[1]);
  const unit = match[2];
  const now = new Date();

  switch (unit) {
    case 'm': // minutes
      now.setMinutes(now.getMinutes() - value);
      break;
    case 'h': // hours
      now.setHours(now.getHours() - value);
      break;
    case 'd': // days
      now.setDate(now.getDate() - value);
      break;
    case 'w': // weeks
      now.setDate(now.getDate() - value * 7);
      break;
    default:
      return null;
  }

  return now;
}

export class DnsLogsApi {
  private app: express.Application;
  private pool: pg.Pool;
  private logger: Logger;
  private server: any;

  constructor(logger: Logger) {
    this.logger = logger;
    this.app = express();

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

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());

    // Logging middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      this.logger.debug(`${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'ok' });
    });

    // Get all DNS requests with pagination and filters
    this.app.get('/dns-requests', async (req: Request, res: Response) => {
      try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 1000);
        const offset = (page - 1) * limit;
        const status = req.query.status as string;
        const orderBy = (req.query.orderBy as string) || 'created_at';
        const order = (req.query.order as string) === 'asc' ? 'ASC' : 'DESC';
        const since = req.query.since as string;

        const conditions: string[] = [];
        const params: any[] = [];

        if (status && ['pending', 'resolved', 'failed'].includes(status)) {
          params.push(status);
          conditions.push(`status = $${params.length}`);
        }

        if (since) {
          const sinceDate = parseDelta(since);
          if (!sinceDate) {
            return res.status(400).json({ error: `Invalid "since" format: "${since}". Use format like "7d", "1w", "24h", "30m"` });
          }
          params.push(sinceDate.toISOString());
          conditions.push(`created_at >= $${params.length}`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const validColumns = ['created_at', 'updated_at', 'response_time_ms', 'hostname', 'client_ip'];
        const orderColumn = validColumns.includes(orderBy) ? orderBy : 'created_at';

        const countQuery = `SELECT COUNT(*) as total FROM dns_requests ${whereClause}`;
        const countResult = await this.pool.query(countQuery, params);
        const total = parseInt(countResult.rows[0].total);

        const dataQuery = `
          SELECT id, client_ip, hostname, query_type, status, resolved_ips,
                 error_message, response_time_ms, created_at, updated_at
          FROM dns_requests
          ${whereClause}
          ORDER BY ${orderColumn} ${order}
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;

        const result = await this.pool.query(dataQuery, [...params, limit, offset]);

        res.json({
          data: result.rows,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        });
      } catch (error) {
        this.logger.error('Error fetching DNS requests:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Get DNS requests by client IP
    this.app.get('/dns-requests/client/:ip', async (req: Request, res: Response) => {
      try {
        const { ip } = req.params;
        const page = parseInt(req.query.page as string) || 1;
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 1000);
        const offset = (page - 1) * limit;

        const countQuery = 'SELECT COUNT(*) as total FROM dns_requests WHERE client_ip = $1';
        const countResult = await this.pool.query(countQuery, [ip]);
        const total = parseInt(countResult.rows[0].total);

        const dataQuery = `
          SELECT id, client_ip, hostname, query_type, status, resolved_ips,
                 error_message, response_time_ms, created_at, updated_at
          FROM dns_requests
          WHERE client_ip = $1
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3
        `;

        const result = await this.pool.query(dataQuery, [ip, limit, offset]);

        res.json({
          data: result.rows,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        });
      } catch (error) {
        this.logger.error('Error fetching DNS requests by client IP:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Get DNS requests by hostname
    this.app.get('/dns-requests/hostname/:hostname', async (req: Request, res: Response) => {
      try {
        const { hostname } = req.params;
        const page = parseInt(req.query.page as string) || 1;
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 1000);
        const offset = (page - 1) * limit;

        const countQuery = 'SELECT COUNT(*) as total FROM dns_requests WHERE hostname = $1';
        const countResult = await this.pool.query(countQuery, [hostname]);
        const total = parseInt(countResult.rows[0].total);

        const dataQuery = `
          SELECT id, client_ip, hostname, query_type, status, resolved_ips,
                 error_message, response_time_ms, created_at, updated_at
          FROM dns_requests
          WHERE hostname = $1
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3
        `;

        const result = await this.pool.query(dataQuery, [hostname, limit, offset]);

        res.json({
          data: result.rows,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        });
      } catch (error) {
        this.logger.error('Error fetching DNS requests by hostname:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Get DNS request statistics
    this.app.get('/dns-requests/stats', async (req: Request, res: Response) => {
      try {
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        // Statistics for different time periods
        const periodStats = await this.pool.query(`
          SELECT
            COUNT(*) as total_requests,
            COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_count,
            COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
            COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
            AVG(response_time_ms) as avg_response_time,
            MAX(response_time_ms) as max_response_time,
            MIN(response_time_ms) as min_response_time,
            COUNT(CASE WHEN created_at >= $1 THEN 1 END) as total_requests_24h,
            COUNT(CASE WHEN created_at >= $1 AND status = 'resolved' THEN 1 END) as resolved_count_24h,
            COUNT(CASE WHEN created_at >= $1 AND status = 'failed' THEN 1 END) as failed_count_24h,
            AVG(CASE WHEN created_at >= $1 THEN response_time_ms END) as avg_response_time_24h,
            COUNT(CASE WHEN created_at >= $2 THEN 1 END) as total_requests_7d,
            COUNT(CASE WHEN created_at >= $2 AND status = 'resolved' THEN 1 END) as resolved_count_7d,
            COUNT(CASE WHEN created_at >= $2 AND status = 'failed' THEN 1 END) as failed_count_7d,
            AVG(CASE WHEN created_at >= $2 THEN response_time_ms END) as avg_response_time_7d
          FROM dns_requests
        `, [oneDayAgo.toISOString(), sevenDaysAgo.toISOString()]);

        const stats = periodStats.rows[0];
        const overall = {
          total_requests: stats.total_requests,
          resolved_count: stats.resolved_count,
          failed_count: stats.failed_count,
          pending_count: stats.pending_count,
          avg_response_time: stats.avg_response_time,
          max_response_time: stats.max_response_time,
          min_response_time: stats.min_response_time,
        };
        const last24h = {
          total_requests: stats.total_requests_24h,
          resolved_count: stats.resolved_count_24h,
          failed_count: stats.failed_count_24h,
          avg_response_time: stats.avg_response_time_24h,
        };
        const last7d = {
          total_requests: stats.total_requests_7d,
          resolved_count: stats.resolved_count_7d,
          failed_count: stats.failed_count_7d,
          avg_response_time: stats.avg_response_time_7d,
        };

        // Top hostnames
        const topHostnames = await this.pool.query(`
          SELECT hostname, COUNT(*) as request_count
          FROM dns_requests
          GROUP BY hostname
          ORDER BY request_count DESC
          LIMIT 10
        `);

        // Top client IPs
        const topClients = await this.pool.query(`
          SELECT client_ip, COUNT(*) as request_count
          FROM dns_requests
          GROUP BY client_ip
          ORDER BY request_count DESC
          LIMIT 10
        `);

        // Requests per status
        const statusBreakdown = await this.pool.query(`
          SELECT status, COUNT(*) as count
          FROM dns_requests
          GROUP BY status
        `);

        // Recent errors
        const recentErrors = await this.pool.query(`
          SELECT hostname, client_ip, error_message, created_at
          FROM dns_requests
          WHERE status = 'failed'
          ORDER BY created_at DESC
          LIMIT 10
        `);

        // Slowest queries
        const slowestQueries = await this.pool.query(`
          SELECT hostname, client_ip, response_time_ms, created_at
          FROM dns_requests
          WHERE response_time_ms IS NOT NULL
          ORDER BY response_time_ms DESC
          LIMIT 10
        `);

        res.json({
          overall,
          last24h,
          last7d,
          topHostnames: topHostnames.rows,
          topClients: topClients.rows,
          statusBreakdown: statusBreakdown.rows,
          recentErrors: recentErrors.rows,
          slowestQueries: slowestQueries.rows,
        });
      } catch (error) {
        this.logger.error('Error fetching DNS request statistics:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Get unique hostnames
    this.app.get('/dns-requests/unique/hostnames', async (req: Request, res: Response) => {
      try {
        const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);

        const result = await this.pool.query(`
          SELECT DISTINCT hostname
          FROM dns_requests
          ORDER BY hostname
          LIMIT $1
        `, [limit]);

        res.json({
          hostnames: result.rows.map(row => row.hostname),
        });
      } catch (error) {
        this.logger.error('Error fetching unique hostnames:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Get unique client IPs
    this.app.get('/dns-requests/unique/clients', async (req: Request, res: Response) => {
      try {
        const result = await this.pool.query(`
          SELECT DISTINCT client_ip
          FROM dns_requests
          ORDER BY client_ip
        `);

        res.json({
          clients: result.rows.map(row => row.client_ip),
        });
      } catch (error) {
        this.logger.error('Error fetching unique clients:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Search DNS requests
    this.app.get('/dns-requests/search', async (req: Request, res: Response) => {
      try {
        const query = req.query.q as string;
        if (!query) {
          return res.status(400).json({ error: 'Query parameter "q" is required' });
        }

        const page = parseInt(req.query.page as string) || 1;
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 1000);
        const offset = (page - 1) * limit;

        const searchPattern = `%${query}%`;

        const countQuery = `
          SELECT COUNT(*) as total
          FROM dns_requests
          WHERE hostname ILIKE $1 OR client_ip ILIKE $1
        `;
        const countResult = await this.pool.query(countQuery, [searchPattern]);
        const total = parseInt(countResult.rows[0].total);

        const dataQuery = `
          SELECT id, client_ip, hostname, query_type, status, resolved_ips,
                 error_message, response_time_ms, created_at, updated_at
          FROM dns_requests
          WHERE hostname ILIKE $1 OR client_ip ILIKE $1
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3
        `;

        const result = await this.pool.query(dataQuery, [searchPattern, limit, offset]);

        res.json({
          data: result.rows,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        });
      } catch (error) {
        this.logger.error('Error searching DNS requests:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  }

  public start(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(port, () => {
        this.logger.info(`DNS Logs API listening on port ${port}`);
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server.close(() => {
          this.logger.info('DNS Logs API stopped');
          resolve();
        });
      });
    }
    await this.pool.end();
  }
}
