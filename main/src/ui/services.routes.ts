import express, { type Request, type Response, type NextFunction } from 'express';
import * as serviceRepository from '../storage/service.repository.js';
import type { KeeneticApi } from '../keenetic-api.js';
import { matchDomainsAgainstPatterns } from '../utils/dns-log-processor.js';
import { filterIpsCoveredByOptimizedRoutes } from '../utils/route-optimizer.js';

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

interface SimpleDnsEntry {
  hostname: string;
  ips: string[];
}

async function getLastUniqueDnsRequestsFromApi(limit: number = 100): Promise<SimpleDnsEntry[]> {
  try {
    const response = await fetch(`${DNS_API_URL}/dns-requests?limit=${limit}&status=resolved&orderBy=created_at&order=desc`);

    if (!response.ok) {
      throw new Error(`DNS API returned ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    const logs = result.data as DnsLogEntry[];

    // Get unique hostnames (latest entry per hostname)
    const domainMap = new Map<string, DnsLogEntry>();

    for (const entry of logs) {
      const existing = domainMap.get(entry.hostname);
      if (!existing || new Date(entry.created_at) > new Date(existing.created_at)) {
        domainMap.set(entry.hostname, entry);
      }
    }

    // Convert to the format expected by existing code
    return Array.from(domainMap.values()).map(entry => ({
      hostname: entry.hostname,
      ips: entry.resolved_ips || []
    }));
  } catch (error) {
    console.error('Error fetching DNS logs from API:', error);
    throw error;
  }
}

/**
 * Extract unique IPs from DNS entries
 * @param entries - Array of DNS entries
 * @returns Array of unique IP addresses
 */
function extractUniqueIpsFromEntries(entries: SimpleDnsEntry[]): string[] {
  const ipSet = new Set<string>();

  for (const entry of entries) {
    for (const ip of entry.ips) {
      // Skip blocked entries (0.0.0.0) and invalid IPs
      if (ip !== '0.0.0.0' && ip) {
        ipSet.add(ip);
      }
    }
  }

  return Array.from(ipSet);
}

const stringToArray = (input?: string): string[] => {
  if (!input) return [];
  // Split by comma, space, or newline, then trim and filter empty strings
  return input.split(/[\n,\s]+/).map(item => item.trim()).filter(Boolean);
}

type ServiceWithRoutes = serviceRepository.Service & {
  routes: {
    network?: string;
    mask?: string;
    host?: string;
    interface: string;
    comment: string;
    gateway?: string;
    metric?: number;
    auto?: boolean;
  }[];
};

export function createServicesRouter(api: KeeneticApi): express.Router {
  const servicesRouter = express.Router();

  // Middleware to parse URL-encoded data (for form submissions)
  servicesRouter.use(express.urlencoded({ extended: true }));

  // Route to display list of services
  servicesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
    const services = await serviceRepository.getAllServices();
    const interfaces = await api.getInterfaces();
    const notConnectedInterfaces = interfaces.filter(i => !i.connected)

    const servicesWithInterfaceNames = services.map(service => ({
      ...service,
      interfaces: service.interfaces.map(ifaceIdOrName => interfaces.find(i => i.name === ifaceIdOrName || i.id === ifaceIdOrName)?.name || ifaceIdOrName),
    }));

    res.render('services/list', { services: servicesWithInterfaceNames, interfaces, notConnectedInterfaces, title: 'Services', currentPath: req.path });
  });

  // Route to display form for creating a new service
  servicesRouter.get('/create', async (req: Request, res: Response) => {
    const interfaces = await api.getInterfaces();

    // Extract query parameters for prefilling
    const { interfaces: ifacesParam, domain } = req.query;

    const service: Partial<serviceRepository.Service> = {};

    // Prefill interfaces if provided
    if (ifacesParam && typeof ifacesParam === 'string') {
      service.interfaces = stringToArray(ifacesParam);
    } else if (interfaces.length > 0) {
      // Pre-select first available interface on creation
      service.interfaces = [interfaces[0].name];
    }

    // Prefill name and matchingDomains if domain is provided
    if (domain && typeof domain === 'string') {
      service.name = domain;
      service.matchingDomains = [domain];
    }

    res.render('services/create', { title: 'Create New Service', service, error: null, currentPath: req.path, interfaces, invalidInterface: null });
  });

  servicesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).send('Invalid service ID');
        return;
      }
      const service = await serviceRepository.getServiceById(id);
      if (!service) {
        res.status(404).send('Service not found');
        return;
      }
      const interfaces = await api.getInterfaces();
      const routes = await api.getRoutes();

      const serviceWithRoutes: ServiceWithRoutes = {
        ...service,
        interfaces: service.interfaces.map(ifaceIdOrName => interfaces.find(i => i.name === ifaceIdOrName || i.id === ifaceIdOrName)?.name || ifaceIdOrName),
        routes: routes.filter(route => route.comment && route.comment.includes(service.name))
      };

      res.render('services/detail', { service: serviceWithRoutes, title: `Service: ${service.name}`, currentPath: req.path });
    } catch (error) {
      next(error);
    }
  });

  // Route to handle creation of a new service
  servicesRouter.post('/create', async (req: Request, res: Response, next: NextFunction) => {
    const { name, interfaces, matchingDomains, optimizeRoutes } = req.body;
    try {
      const newServiceData: serviceRepository.NewService = {
        name,
        interfaces: interfaces ? [interfaces] : [],
        matchingDomains: stringToArray(matchingDomains),
        optimizeRoutes: optimizeRoutes === 'on' || optimizeRoutes === 'true',
      };
      const newService = await serviceRepository.createService(newServiceData);

      // Process last 100 DNS requests and add matching domains to VPN routing
      if (newServiceData.matchingDomains.length > 0) {
        try {
          // Get last 100 unique DNS requests from API
          const dnsRequests = await getLastUniqueDnsRequestsFromApi(100);

          // Extract all hostnames
          const hostnames = dnsRequests.map(req => req.hostname);

          // Find matching domains
          const matchedDomains = matchDomainsAgainstPatterns(hostnames, newServiceData.matchingDomains);

          if (matchedDomains.length > 0) {
            // Filter DNS requests to only those with matched domains
            const matchedRequests = dnsRequests.filter(req => matchedDomains.includes(req.hostname));

            // Extract unique IPs from matched requests
            let ips = extractUniqueIpsFromEntries(matchedRequests);

            // If optimize routes is enabled, check if IPs are already covered by optimized routes
            if (newServiceData.optimizeRoutes) {
              const currentRoutes = await api.getRoutes();
              const commentPrefix = `dns-auto:${name}`;
              const { coveredIps, uncoveredIps } = filterIpsCoveredByOptimizedRoutes(
                ips,
                currentRoutes,
                commentPrefix
              );

              if (coveredIps.length > 0) {
                console.log(
                  `Skipping ${coveredIps.length} IP(s) already covered by optimized routes for service "${name}": ${coveredIps.join(', ')}`
                );
              }

              ips = uncoveredIps;
            }

            if (ips.length > 0) {
              console.log(`Adding ${ips.length} IPs for ${matchedDomains.length} matched domains to VPN routing for service "${name}"`);

              // Add routes for the matched IPs
              await api.addStaticRoutesForService({
                ips,
                interfaces: newServiceData.interfaces,
                comment: `dns-auto:${name}`,
              });
            } else if (newServiceData.optimizeRoutes) {
              console.log(`All IPs for service "${name}" are already covered by optimized routes`);
            }
          }
        } catch (dnsError) {
          console.error('Error processing DNS logs for new service:', dnsError);
          // Continue even if DNS processing fails - service is already created
        }
      }

      res.redirect('/services/' + newService.id);
    } catch (error) {
      console.error('Create service error:', error);
      // Check for unique constraint error (specific to SQLite, might need adjustment for other DBs)
      if (error instanceof Error && (error.message.includes('UNIQUE constraint failed: services.name') || (error as any).code === 'SQLITE_CONSTRAINT_UNIQUE')) {
        const availableInterfaces = await api.getInterfaces();
        res.status(400).render('services/create', {
          title: 'Create New Service',
          service: { name, interfaces: interfaces ? [interfaces] : [], matchingDomains }, // Repopulate form with submitted values
          error: 'Service name already exists. Please choose a different name.',
          currentPath: '/services/create',
          interfaces: availableInterfaces,
          invalidInterface: null
        });
      } else {
        next(error);
      }
    }
  });

  // Route to display form for updating an existing service
  servicesRouter.get('/update/:id', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).send('Invalid service ID');
        return;
      }
      const service = await serviceRepository.getServiceById(id);
      if (!service) {
        res.status(404).send('Service not found');
        return;
      }
      const interfaces = await api.getInterfaces();

      // Check if current interface(s) are valid
      let invalidInterface: string | null = null;
      const currentInterface = service.interfaces && service.interfaces.length > 0 ? service.interfaces[0] : null;

      if (currentInterface) {
        const isValid = interfaces.some(iface => iface.name === currentInterface || iface.id === currentInterface);
        if (!isValid) {
          invalidInterface = currentInterface;
          // Pre-select first available interface
          if (interfaces.length > 0) {
            service.interfaces = [interfaces[0].name];
          }
        }
      } else if (interfaces.length > 0) {
        // No interface selected, pre-select first available
        service.interfaces = [interfaces[0].name];
      }

      res.render('services/update', { title: 'Update Service', service, error: null, currentPath: req.path, interfaces, invalidInterface });
    } catch (error) {
      next(error);
    }
  });

  // Route to handle update of an existing service
  servicesRouter.post('/update/:id', async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const { name, interfaces, matchingDomains, optimizeRoutes } = req.body;
    try {
      if (isNaN(id)) {
        res.status(400).send('Invalid service ID');
        return;
      }

      const updateData: serviceRepository.UpdateService = {
        name,
        interfaces: interfaces ? [interfaces] : [],
        matchingDomains: stringToArray(matchingDomains),
        optimizeRoutes: optimizeRoutes === 'on' || optimizeRoutes === 'true',
      };
      const updatedService = await serviceRepository.updateService(id, updateData);
      if (!updatedService) {
        const availableInterfaces = await api.getInterfaces();
        res.status(404).render('services/update', {
          title: 'Update Service',
          service: { id, name, interfaces: interfaces ? [interfaces] : [], matchingDomains }, // Original data + attempted updates
          error: 'Service not found or failed to update.',
          currentPath: `/services/update/${id}`,
          interfaces: availableInterfaces,
          invalidInterface: null
        });
        return;
      }
      res.redirect('/services');
    } catch (error) {
      console.error(`Update service error for ID ${id}:`, error);
      if (error instanceof Error && (error.message.includes('UNIQUE constraint failed: services.name') || (error as any).code === 'SQLITE_CONSTRAINT_UNIQUE')) {
        const availableInterfaces = await api.getInterfaces();
        res.status(400).render('services/update', {
          title: 'Update Service',
          service: { id, name, interfaces: interfaces ? [interfaces] : [], matchingDomains }, // Repopulate with submitted values
          error: 'Service name already exists. Please choose a different name.',
          currentPath: `/services/update/${id}`,
          interfaces: availableInterfaces,
          invalidInterface: null
        });
      } else {
        next(error);
      }
    }
  });

  // Route to handle deletion of a service
  servicesRouter.post('/delete/:id', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).send('Invalid service ID');
        return;
      }
      await serviceRepository.deleteService(id);
      res.redirect('/services');
    } catch (error) {
      next(error);
    }
  });

  servicesRouter.post('/remove-routes/:id', async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).send('Invalid service ID');
      return;
    }

    const service = await serviceRepository.getServiceById(id);
    if (!service) {
      res.status(404).send('Service not found');
      return;
    }

    const success = await api.removeRoutesByCommentPrefix('dns-auto:' + service.name);
    if (!success) {
      res.status(500).send('Failed to remove routes');
      return;
    }

    res.redirect(`/services/${id}`);
  });

  // Route to toggle service enabled/disabled status
  servicesRouter.post('/toggle-enabled/:id', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).send('Invalid service ID');
        return;
      }

      const service = await serviceRepository.getServiceById(id);
      if (!service) {
        res.status(404).send('Service not found');
        return;
      }

      // Toggle the enabled status
      const newEnabledStatus = !service.enabled;
      await serviceRepository.updateService(id, { enabled: newEnabledStatus });

      // If disabling, remove all routes for this service
      if (!newEnabledStatus) {
        await api.removeRoutesByCommentPrefix('dns-auto:' + service.name);
      }

      res.redirect(`/services/${id}`);
    } catch (error) {
      next(error);
    }
  });

  // Basic error handler (you should have a more sophisticated one in your main app.ts)
  servicesRouter.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error("[Service UI Error]:", err);
    res.status(500).send('Something broke in the services UI! Check server logs.');
  });

  return servicesRouter;
}
