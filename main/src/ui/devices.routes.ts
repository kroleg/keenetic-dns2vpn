import express, { type Request, type Response, type NextFunction } from 'express';
import type { KeeneticApi } from '../keenetic-api.js';

export function createDevicesRouter(api: KeeneticApi): express.Router {
  const router = express.Router();

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clients = await api.getClients();
      const policies = await api.getClientsPolicies();
      res.render('devices/list', {
        clients,
        policies,
        title: 'Devices',
        currentPath: req.path,
      });
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






