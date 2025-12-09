import express, { type Request, type Response, type NextFunction } from 'express';
import type { KeeneticApi } from '../keenetic-api.js';

export function createApiRouter(api: KeeneticApi): express.Router {
  const router = express.Router();

  router.use(express.json());

  // Get current device info by IP (used to identify the caller)
  router.get('/device/:ip', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ip } = req.params;
      const client = await api.getClientByIp(ip);

      if (!client) {
        res.status(404).json({ error: 'Device not found' });
        return;
      }

      const policies = await api.getConnectionPolicies();
      const currentPolicy = client.policy
        ? policies.find(p => p.id === client.policy)
        : null;

      res.json({
        name: client.name,
        ip: client.ip,
        mac: client.mac,
        policy: client.policy || null,
        policyName: currentPolicy?.name || currentPolicy?.description || client.policy || null,
        registered: client.registered,
      });
    } catch (error) {
      next(error);
    }
  });

  // Get all available connection policies
  router.get('/policies', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const policies = await api.getConnectionPolicies();
      res.json(policies);
    } catch (error) {
      next(error);
    }
  });

  // Set policy for a device by MAC address
  router.post('/device/:mac/policy', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { mac } = req.params;
      const { policyId } = req.body;

      // policyId can be null to remove policy
      const success = await api.setClientPolicy(mac, policyId || null);

      if (success) {
        res.json({ success: true, message: `Policy ${policyId || 'removed'} for device ${mac}` });
      } else {
        res.status(500).json({ success: false, error: 'Failed to set policy' });
      }
    } catch (error) {
      next(error);
    }
  });

  // Error handler
  router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[API Error]:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return router;
}
