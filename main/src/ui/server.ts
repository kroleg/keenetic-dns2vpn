import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServicesRouter } from './services.routes.js';
import { createLogsRouter } from './logs.routes.js';
import { createDevicesRouter } from './devices.routes.js';
import type { Logger } from 'winston';
import type { KeeneticApi } from '../keenetic-api.js';

export function startUI(logger: Logger, api: KeeneticApi) {

  // Get __dirname in ES module scope
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // --- Express App Setup ---
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Configure Pug as the view engine
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'pug');

  app.use('/services', createServicesRouter(api));
  app.use('/logs', createLogsRouter({ api }));
  app.use('/devices', createDevicesRouter(api));

  app.get('/', (req: Request, res: Response) => {
    res.redirect('/services');
  });
  // --- End Express App Setup ---

  // Start the Express server
  const server = app.listen(PORT, (err: any) => {
    if (err) {
      logger.error('Error starting server:', err);
      process.exit(1);
    }
    logger.info(`Server is running on http://localhost:${PORT}`);
  });

  // Graceful shutdown
  return {
    gracefulShutdown: () => {
      logger.debug('[UI] Attempting to gracefully shutdown...');
      try {
        server.close();
        logger.debug('[UI] Server stopped.');
      } catch (err: any) { // err from tail.quit() might be specific, using any for now
        logger.error('[UI] Error during shutdown:', err);
      }
    }
  }
}
