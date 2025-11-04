import express, { type Request, type Response, type NextFunction } from 'express';
import * as serviceRepository from '../storage/service.repository.js';
import type { KeeneticApi } from '../keenetic-api.js';
import { getLastUniqueDnsRequests, matchDomainsAgainstPatterns, extractUniqueIps } from '../utils/dns-log-processor.js';

const stringToArray = (input?: string): string[] => {
  if (!input) return [];
  return input.split(',').map(item => item.trim()).filter(Boolean);
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

export function createServicesRouter(api: KeeneticApi, logFilePath?: string): express.Router {
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
    }

    // Prefill name and matchingDomains if domain is provided
    if (domain && typeof domain === 'string') {
      service.name = domain;
      service.matchingDomains = [domain];
    }

    res.render('services/create', { title: 'Create New Service', service, error: null, currentPath: req.path, interfaces });
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
    const { name, interfaces, matchingDomains } = req.body;
    try {
      const newServiceData: serviceRepository.NewService = {
        name,
        interfaces: stringToArray(interfaces),
        matchingDomains: stringToArray(matchingDomains),
      };
      const newService = await serviceRepository.createService(newServiceData);

      // Process last 100 DNS requests and add matching domains to VPN routing
      if (logFilePath && newServiceData.matchingDomains.length > 0) {
        try {
          // Get last 100 unique DNS requests
          const dnsRequests = await getLastUniqueDnsRequests(logFilePath, 100);

          // Extract all hostnames
          const hostnames = dnsRequests.map(req => req.hostname);

          // Find matching domains
          const matchedDomains = matchDomainsAgainstPatterns(hostnames, newServiceData.matchingDomains);

          if (matchedDomains.length > 0) {
            // Filter DNS requests to only those with matched domains
            const matchedRequests = dnsRequests.filter(req => matchedDomains.includes(req.hostname));

            // Extract unique IPs from matched requests
            const ips = extractUniqueIps(matchedRequests);

            if (ips.length > 0) {
              console.log(`Adding ${ips.length} IPs for ${matchedDomains.length} matched domains to VPN routing for service "${name}"`);

              // Add routes for the matched IPs
              await api.addStaticRoutesForService({
                ips,
                interfaces: newServiceData.interfaces,
                comment: `dns-auto:${name}`,
              });
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
        res.status(400).render('services/create', {
          title: 'Create New Service',
          service: { name, interfaces, matchingDomains }, // Repopulate form with submitted values
          error: 'Service name already exists. Please choose a different name.',
          currentPath: '/services/create'
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
      res.render('services/update', { title: 'Update Service', service, error: null, currentPath: req.path, interfaces });
    } catch (error) {
      next(error);
    }
  });

  // Route to handle update of an existing service
  servicesRouter.post('/update/:id', async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const { name, interfaces, matchingDomains } = req.body;
    try {
      if (isNaN(id)) {
        res.status(400).send('Invalid service ID');
        return;
      }

      const updateData: serviceRepository.UpdateService = {
        name,
        interfaces: stringToArray(interfaces),
        matchingDomains: stringToArray(matchingDomains),
      };
      const updatedService = await serviceRepository.updateService(id, updateData);
      if (!updatedService) {
        res.status(404).render('services/update', {
          title: 'Update Service',
          service: { id, name, interfaces, matchingDomains }, // Original data + attempted updates
          error: 'Service not found or failed to update.',
          currentPath: `/services/update/${id}`
        });
        return;
      }
      res.redirect('/services');
    } catch (error) {
      console.error(`Update service error for ID ${id}:`, error);
      if (error instanceof Error && (error.message.includes('UNIQUE constraint failed: services.name') || (error as any).code === 'SQLITE_CONSTRAINT_UNIQUE')) {
        res.status(400).render('services/update', {
          title: 'Update Service',
          service: { id, name, interfaces, matchingDomains }, // Repopulate with submitted values
          error: 'Service name already exists. Please choose a different name.',
          currentPath: `/services/update/${id}`
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

  // Basic error handler (you should have a more sophisticated one in your main app.ts)
  servicesRouter.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error("[Service UI Error]:", err);
    res.status(500).send('Something broke in the services UI! Check server logs.');
  });

  return servicesRouter;
}
