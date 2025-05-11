import express, { type Request, type Response, type NextFunction  } from 'express';
import * as serviceRepository from '../storage/service.repository.js';

export const servicesRouter = express.Router();

const stringToArray = (input?: string): string[] => {
  if (!input) return [];
  return input.split(',').map(item => item.trim()).filter(Boolean);
}

// Middleware to parse URL-encoded data (for form submissions)
servicesRouter.use(express.urlencoded({ extended: true }));

// Route to display list of services
servicesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  const services = await serviceRepository.getAllServices();
  res.render('services/list', { services, title: 'Services', currentPath: req.path });
});

// Route to display form for creating a new service
servicesRouter.get('/create', (req: Request, res: Response) => {
  res.render('services/create', { title: 'Create New Service', service: {}, error: null, currentPath: req.path });
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
    await serviceRepository.createService(newServiceData);
    res.redirect('/services');
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
    if (isNaN(id))  {
      res.status(400).send('Invalid service ID');
      return;
    }
    const service = await serviceRepository.getServiceById(id);
    if (!service) {
      res.status(404).send('Service not found');
      return;
    }
    res.render('services/update', { title: 'Update Service', service, error: null, currentPath: req.path });
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

// Basic error handler (you should have a more sophisticated one in your main app.ts)
servicesRouter.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("[Service UI Error]:", err);
  res.status(500).send('Something broke in the services UI! Check server logs.');
});
