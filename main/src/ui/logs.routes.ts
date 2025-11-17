import express, { type Request, type Response, type NextFunction } from 'express';
import type { KeeneticApi } from '../keenetic-api.js';

const DNS_API_URL = process.env.DNS_API_URL || 'http://dns-proxy:3001';

interface DnsLogEntry {
  id: number;
  client_ip: string;
  hostname: string;
  query_type: string;
  status: string;
  resolved_ips: string[] | null;
  error_message: string | null;
  response_time_ms: number | null;
  created_at: string;
  updated_at: string;
}

export function createLogsRouter({ api }: { api: KeeneticApi }): express.Router {
  const router = express.Router();

  // Route to display list of connected clients
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clients = await api.getClients();

      // Fetch DNS stats from API
      let stats = null;
      try {
        const statsResponse = await fetch(`${DNS_API_URL}/dns-requests/stats`);
        if (statsResponse.ok) {
          stats = await statsResponse.json();
        }
      } catch (statsError) {
        console.error('Error fetching DNS stats:', statsError);
        // Continue without stats if API is unavailable
      }

      res.render('logs/list', {
        clients,
        stats,
        title: 'Logs',
        currentPath: req.path
      });
    } catch (error) {
      next(error);
    }
  });


  // Route to display failed requests
  router.get('/failed/all', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = 50;

      const response = await fetch(`${DNS_API_URL}/dns-requests?status=failed&page=${page}&limit=${limit}&orderBy=created_at&order=desc`);

      if (!response.ok) {
        throw new Error(`DNS API returned ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      res.render('logs/failed', {
        failedRequests: result.data,
        pagination: result.pagination,
        title: 'Failed DNS Requests',
        currentPath: req.path
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:ip', async (req: Request, res: Response, next: NextFunction) => {
    const clientIp = req.params.ip !== 'my' ? req.params.ip : req.ip?.replace('::ffff:', '')
    if (!clientIp) {
      res.send('Cant read ip')
      return
    }

    try {
      const logs = await getHostnamesAndIpsForClient(clientIp)

      res.type('text').send(logs.map(line => {
        const date = formatShortDate(line.created_at)
        const blockedInfo = line.resolved_ips?.[0] === '0.0.0.0' ? 'b' : ' '
        const statusIcon = line.status === 'failed' ? '❌' : '  '
        const responseTime = line.response_time_ms !== null ? `${line.response_time_ms}ms`.padStart(6) : '     -'
        return `${date} | ${statusIcon} | ${responseTime} | ${blockedInfo} | ${line.hostname}`
      }).join('\n'))
    } catch (error) {
      next(error);
    }
  });

  return router;
}


async function getHostnamesAndIpsForClient(targetClientIp: string): Promise<DnsLogEntry[]> {
  try {
    // Fetch all logs for this client from the DNS API
    const response = await fetch(`${DNS_API_URL}/dns-requests/client/${encodeURIComponent(targetClientIp)}?limit=1000`);

    if (!response.ok) {
      throw new Error(`DNS API returned ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    const logs = result.data as DnsLogEntry[];

    // Get unique hostnames (latest entry per hostname)
    const domainMap = new Map<string, DnsLogEntry>();

    for (const entry of logs) {
      // Include resolved and failed entries (skip pending)
      if (entry.status === 'resolved' || entry.status === 'failed') {
        const existing = domainMap.get(entry.hostname);
        if (!existing || new Date(entry.created_at) > new Date(existing.created_at)) {
          domainMap.set(entry.hostname, entry);
        }
      }
    }

    // Sort by timestamp (newest first)
    const uniqueLogs = Array.from(domainMap.values())
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return uniqueLogs;
  } catch (error) {
    console.error('Error fetching DNS logs from API:', error);
    throw error;
  }
}

function formatShortDate(date: string) {
  const now = new Date();
  const input = new Date(date);

  // Helper for leading zeros
  const pad = (n: number) => n.toString().padStart(2, '0');

  // Time part
  const timeStr = pad(input.getHours()) + ':' + pad(input.getMinutes());

  // "Today"
  if (
    now.getDate() === input.getDate() &&
    now.getMonth() === input.getMonth() &&
    now.getFullYear() === input.getFullYear()
  ) {
    return `       ${timeStr}`;
  }

  // "Yesterday"
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (
    input.getDate() === yesterday.getDate() &&
    input.getMonth() === yesterday.getMonth() &&
    input.getFullYear() === yesterday.getFullYear()
  ) {
    return `-1day ${timeStr}`;
  }

  // Short date: "24 may, 01:10"
  const day = input.getDate();
  const month = input.toLocaleString('default', { month: 'short' }); // "May"
  return `${day} ${month} ${timeStr}`;
}
