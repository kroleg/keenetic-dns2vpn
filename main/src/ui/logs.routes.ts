import express, { type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import readline from 'node:readline';
import type { KeeneticApi } from '../keenetic-api.js';

export function createLogsRouter({ logFilePath, api }: { logFilePath: string, api: KeeneticApi }): express.Router {
  const router = express.Router();

  // Route to display list of connected clients
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clients = await api.getClients();
      res.render('logs/list', {
        clients,
        title: 'Logs',
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

    const logs = await getHostnamesAndIpsForClient(logFilePath, clientIp)

    res.type('text').send(logs.map(line => {
      const date = formatShortDate(line.ts)
      const blockedInfo = line.ips[0] === '0.0.0.0' ? 'b' : ' '
      return `${date} | ${blockedInfo} | ${line.hostname}`
    }).join('\n'))
  });

  return router;
}


// format:  {"ts":"2025-05-24T09:32:45.263Z","clientIp":"192.168.1.122","hostname":"example.com","ips":["34.235.220.69"]}
async function getHostnamesAndIpsForClient(logFile: string, targetClientIp: string) {
  const fileStream = fs.createReadStream(logFile);

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const domainMap = new Map<string, any>(); // Map to store latest entry for each domain

  for await (const line of rl) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (e) {
      console.error('Invalid JSON:', line);
      continue;
    }
    if (entry.clientIp === targetClientIp) {
      domainMap.set(entry.hostname, entry);
    }
  }

  const uniqueLogs = Array.from(domainMap.values())
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  return uniqueLogs;
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
