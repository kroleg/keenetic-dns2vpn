import express, { type Request, type Response, type NextFunction } from 'express';
import dns from 'dns/promises';
import type { KeeneticApi } from '../keenetic-api.js';

interface RouteMatch {
  ip: string;
  matched: boolean;
  matchedRoute?: {
    type: 'host' | 'network';
    host?: string;
    network?: string;
    mask?: string;
    interface: string;
    comment: string;
  };
}

function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function isIpInNetwork(ip: string, network: string, mask: string): boolean {
  const ipNum = ipToNumber(ip) >>> 0;
  const networkNum = ipToNumber(network) >>> 0;
  const maskNum = ipToNumber(mask) >>> 0;
  return (ipNum & maskNum) === (networkNum & maskNum);
}

export function createCheckRouter(api: KeeneticApi): express.Router {
  const router = express.Router();

  router.use(express.urlencoded({ extended: true }));

  router.get('/', async (_req: Request, res: Response) => {
    res.render('check/index', {
      title: 'Check Domain Routing',
      domain: '',
      result: null,
      error: null
    });
  });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    const { domain } = req.body;

    if (!domain || typeof domain !== 'string') {
      res.render('check/index', {
        title: 'Check Domain Routing',
        domain: '',
        result: null,
        error: 'Please enter a domain name'
      });
      return;
    }

    const cleanDomain = domain.trim().toLowerCase();

    try {
      // Resolve domain to IPs
      let ips: string[];
      try {
        ips = await dns.resolve4(cleanDomain);
      } catch (dnsError: any) {
        res.render('check/index', {
          title: 'Check Domain Routing',
          domain: cleanDomain,
          result: null,
          error: `Failed to resolve domain: ${dnsError.code || dnsError.message}`
        });
        return;
      }

      // Get all routes from router
      const routes = await api.getRoutes();

      // Check each IP against routes
      const matches: RouteMatch[] = ips.map(ip => {
        // First check host routes
        const hostRoute = routes.find(r => r.host === ip);
        if (hostRoute) {
          return {
            ip,
            matched: true,
            matchedRoute: {
              type: 'host' as const,
              host: hostRoute.host,
              interface: hostRoute.interface,
              comment: hostRoute.comment
            }
          };
        }

        // Then check network routes
        const networkRoute = routes.find(r =>
          r.network && r.mask && isIpInNetwork(ip, r.network, r.mask)
        );
        if (networkRoute) {
          return {
            ip,
            matched: true,
            matchedRoute: {
              type: 'network' as const,
              network: networkRoute.network,
              mask: networkRoute.mask,
              interface: networkRoute.interface,
              comment: networkRoute.comment
            }
          };
        }

        return { ip, matched: false };
      });

      const allMatched = matches.every(m => m.matched);
      const someMatched = matches.some(m => m.matched);

      res.render('check/index', {
        title: 'Check Domain Routing',
        domain: cleanDomain,
        result: {
          ips: matches,
          allMatched,
          someMatched,
          totalIps: ips.length,
          matchedCount: matches.filter(m => m.matched).length
        },
        error: null
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
