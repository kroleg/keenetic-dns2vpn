import express, { type Request, type Response, type NextFunction } from 'express';
import type { KeeneticApi } from '../keenetic-api.js';

export function createDevicesRouter(api: KeeneticApi): express.Router {
  const router = express.Router();

  router.use(express.urlencoded({ extended: true }));

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clients = await api.getClients();
      const registeredPolicies = await api.getClientsPolicies();
      const connectionPolicies = await api.getConnectionPolicies();

      // Enrich clients with their registered policy from config
      const enrichedClients = await Promise.all(clients.map(async (client) => {
        // Find registered host config by MAC
        const registeredHost = Object.values(registeredPolicies).find(
          (h: any) => h.mac?.toLowerCase() === client.mac?.toLowerCase()
        );
        const policy = registeredHost?.policy || registeredHost?.["ip-policy"];
        return {
          ...client,
          policy,
          mac: client.mac,
        };
      }));

      res.render('devices/list', {
        clients: enrichedClients,
        policies: registeredPolicies,
        connectionPolicies,
        title: 'Devices',
        currentPath: req.path,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/toggle-vpn', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { mac, policyId } = req.body;

      if (!mac) {
        res.status(400).send('MAC address is required');
        return;
      }

      // policyId empty = turn off VPN (remove policy), otherwise set the policy
      const success = await api.setClientPolicy(mac, policyId || null);

      if (!success) {
        res.status(500).send('Failed to update policy');
        return;
      }

      res.redirect('/devices');
    } catch (error) {
      next(error);
    }
  });

  router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Devices UI Error]:', err);
    res.status(500).send('Something broke in the devices UI! Check server logs.');
  });

  return router;
}






