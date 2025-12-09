import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3002;
const MAIN_API_URL = process.env.MAIN_API_URL || 'http://dns-to-vpn:3000/api';

// Configure Pug as the view engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

// Parse URL-encoded bodies (for form submissions)
app.use(express.urlencoded({ extended: true }));

// Helper function to get client IP from request
function getClientIp(req: Request): string {
  // Check for X-Forwarded-For header (when behind proxy)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = typeof forwarded === 'string' ? forwarded : forwarded[0];
    return ips.split(',')[0].trim();
  }
  // Fall back to direct connection IP
  return req.socket.remoteAddress || req.ip || '';
}

// Normalize IPv6-mapped IPv4 addresses
function normalizeIp(ip: string): string {
  // Handle IPv6-mapped IPv4 addresses like ::ffff:192.168.1.100
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7);
  }
  return ip;
}

// Main page - shows current device status and policy options
app.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientIp = normalizeIp(getClientIp(req));

    if (!clientIp) {
      res.render('error', {
        title: 'Error',
        message: 'Could not determine your IP address'
      });
      return;
    }

    // Fetch device info from main API
    const deviceResponse = await fetch(`${MAIN_API_URL}/device/${clientIp}`);

    if (!deviceResponse.ok) {
      if (deviceResponse.status === 404) {
        res.render('error', {
          title: 'Device Not Found',
          message: `Your device (${clientIp}) is not registered on the network. Please connect to the network first.`
        });
        return;
      }
      throw new Error(`API returned ${deviceResponse.status}`);
    }

    const device = await deviceResponse.json();

    // Fetch available policies from main API
    const policiesResponse = await fetch(`${MAIN_API_URL}/policies`);

    if (!policiesResponse.ok) {
      throw new Error(`Failed to fetch policies: ${policiesResponse.status}`);
    }

    const policies = await policiesResponse.json();

    res.render('index', {
      title: 'VPN',
      device,
      policies,
      error: null
    });
  } catch (error) {
    console.error('Error loading page:', error);
    res.render('error', {
      title: 'Error',
      message: 'Failed to load device information. Please try again later.'
    });
  }
});

// Set policy for the current device
app.post('/set-policy', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mac, policyId } = req.body;

    if (!mac) {
      res.render('error', {
        title: 'Error',
        message: 'Device MAC address is required'
      });
      return;
    }

    // Call main API to set policy
    const response = await fetch(`${MAIN_API_URL}/device/${mac}/policy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ policyId: policyId || null })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `API returned ${response.status}`);
    }

    // Redirect back to main page
    res.redirect('/');
  } catch (error) {
    console.error('Error setting policy:', error);
    res.render('error', {
      title: 'Error',
      message: `Failed to update policy: ${(error as Error).message}`
    });
  }
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Server error:', err);
  res.status(500).render('error', {
    title: 'Error',
    message: 'An unexpected error occurred'
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`VPN Toggle UI is running on http://localhost:${PORT}`);
  console.log(`Using Main API at: ${MAIN_API_URL}`);
});
