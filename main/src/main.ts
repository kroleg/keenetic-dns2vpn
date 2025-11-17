import { startFileWatcher } from "./file-watcher.js";
import { KeeneticApi } from './keenetic-api.js';
import { createLogger } from './logger.js';
import { getAllServices, getServiceByName, type Service } from "./storage/service.repository.js";
import { runMigrations } from "./storage/db.js";
import { startUI } from "./ui/server.js";
import { matchWithoutStars, wildcardDomainMatch } from "./matcher.js";
import { optimizeRoutes, calculateOptimizationStats, filterIpsCoveredByOptimizedRoutes } from "./utils/route-optimizer.js";

const logger = createLogger(process.env.LOG_LEVEL || 'info');

if (!process.env.KEENETIC_HOST || !process.env.KEENETIC_LOGIN || !process.env.KEENETIC_PASSWORD) {
    console.error('Error: Missing one or more required environment variables:');
    console.error('  KEENETIC_HOST');
    console.error('  KEENETIC_LOGIN');
    console.error('  KEENETIC_PASSWORD');
    console.log('\nPlease set these environment variables before running the script.');
    console.log("Example: export KEENETIC_HOST='http://192.168.1.1'");
    process.exit(1);
}

const api = new KeeneticApi({
    host: process.env.KEENETIC_HOST!,
    login: process.env.KEENETIC_LOGIN!,
    password: process.env.KEENETIC_PASSWORD!,
    logger,
});

// init db
await runMigrations();
logger.info('Database migrations checked/applied.');

let matchers: { name: string, interfaces: string[], pattern: string }[]

async function fetchMatchers() {
  const existingServices: Service[] = await getAllServices();
  logger.debug(`Fetched ${existingServices.length} services from the database.`);
  existingServices.forEach(service => {
    logger.debug(`Service ID: ${service.id}, Name: ${service.name}, Enabled: ${service.enabled}, Interfaces: ${service.interfaces.join(', ')}, Domains: ${service.matchingDomains.join(', ')}`);
  });
  const list: typeof matchers = []
  // Only include enabled services
  const enabledServices = existingServices.filter(s => s.enabled);
  enabledServices.forEach(service => {
    service.matchingDomains.forEach(pattern => {
      list.push({
        name: service.name,
        interfaces: service.interfaces,
        pattern: pattern,
      })
    })
  })
  matchers = list
}

// Start the interval loop
const refetchMatchersInterval = setInterval(fetchMatchers, 60 * 1000); // every 60 seconds
fetchMatchers()

// Route optimization job
async function optimizeServiceRoutes() {
  try {
    const services = await getAllServices();
    // Only optimize enabled services with route optimization enabled
    const servicesToOptimize = services.filter(s => s.enabled && s.optimizeRoutes);

    if (servicesToOptimize.length === 0) {
      logger.debug('No enabled services with route optimization enabled');
      return;
    }

    logger.info(`Running route optimization for ${servicesToOptimize.length} service(s)`);

    // Fetch all current routes
    const allRoutes = await api.getRoutes();

    for (const service of servicesToOptimize) {
      const commentPrefix = `dns-auto:${service.name}`;

      // Optimize routes for this service
      const { routesToAdd, routesToRemove } = optimizeRoutes(allRoutes, commentPrefix);

      if (routesToAdd.length === 0) {
        logger.debug(`No optimization possible for service: ${service.name}`);
        continue;
      }

      // Calculate stats
      const stats = calculateOptimizationStats(routesToAdd, routesToRemove);
      logger.info(
        `Service "${service.name}": Optimizing ${stats.originalCount} routes into ${stats.optimizedCount} network routes ` +
        `(${stats.reduction} routes removed, ${stats.reductionPercent}% reduction)`
      );

      // Remove old host routes
      for (const route of routesToRemove) {
        await api.removeRoutesByCommentPrefix(route.comment);
      }

      // Add optimized network routes
      for (const route of routesToAdd) {
        await api.addStaticRoutesForService({
          ips: [], // Not used for network routes
          interfaces: [route.interface],
          comment: route.comment,
          network: route.network,
          mask: route.mask,
        });
      }

      logger.info(`Route optimization completed for service: ${service.name}`);
    }
  } catch (error) {
    logger.error('Error during route optimization:', error);
  }
}

// Schedule route optimization job
const optimizationInterval = parseInt(process.env.ROUTE_OPTIMIZATION_INTERVAL || '300000', 10); // default 5 minutes
const routeOptimizationInterval = setInterval(optimizeServiceRoutes, optimizationInterval);
logger.info(`Route optimization job scheduled every ${optimizationInterval / 1000} seconds`);

// Run optimization once at startup
optimizeServiceRoutes();

await startFileWatcher({
  logFilePath: process.env.WATCH_FILE || 'dns-proxy.log',
  onLine: async (line) => {
    try {
        const logEntry = JSON.parse(line) as { hostname: string, ips: string[] };
        if (logEntry && typeof logEntry.hostname === 'string' && Array.isArray(logEntry.ips)) {
            logger.debug(`dns query for ${logEntry.hostname} resolved to IPs: ${logEntry.ips}`);
            const match = matchers.find(m => wildcardDomainMatch(logEntry.hostname, m.pattern) || matchWithoutStars(logEntry.hostname, m.pattern));
            if (match) {
              // Check if service has optimized routes enabled and is enabled
              const service = await getServiceByName(match.name);

              // Skip if service is disabled
              if (!service || !service.enabled) {
                logger.debug(`Skipping disabled service: ${match.name}`);
                return;
              }

              let ipsToAdd = logEntry.ips;

              if (service?.optimizeRoutes) {
                // Get current routes to check if IPs are already covered by optimized routes
                const currentRoutes = await api.getRoutes();
                const commentPrefix = `dns-auto:${match.name}`;
                const { coveredIps, uncoveredIps } = filterIpsCoveredByOptimizedRoutes(
                  logEntry.ips,
                  currentRoutes,
                  commentPrefix
                );

                if (coveredIps.length > 0) {
                  logger.debug(
                    `Skipping ${coveredIps.length} IP(s) already covered by optimized routes for ${logEntry.hostname}: ${coveredIps.join(', ')}`
                  );
                }

                ipsToAdd = uncoveredIps;
              }

              if (ipsToAdd.length === 0) {
                logger.debug(`All IPs for ${logEntry.hostname} are already covered by optimized routes`);
                return;
              }

              api.addStaticRoutesForService({
                ips: ipsToAdd,
                interfaces: match.interfaces,
                comment: 'dns-auto:' + match.name + ':' + logEntry.hostname,
              }).then(resp => {
                if (resp) {
                  // todo differentiate between add and update
                  logger.info(`Adding route for ${logEntry.hostname} (${match.name}) via interfaces: ${match.interfaces.join(', ')} to IPs: ${ipsToAdd}`);
                } else {
                  logger.error('Error adding static route for ' + logEntry.hostname);
                }
              }).catch(e => {
                logger.error('Error adding static route:', e);
              });
            } else {
              logger.debug(`No match found for ${logEntry.hostname}`);
            }
        } else {
            logger.warn('Skipping line, not in expected JSON format or missing properties:', line);
        }
    } catch (e) {
        logger.warn('Error parsing JSON from line:', line, e);
    }
  },
  logger,
});

const { gracefulShutdown: gracefulShutdownUI } = startUI(logger, api);
function gracefulShutdown () {
  clearInterval(refetchMatchersInterval)
  clearInterval(routeOptimizationInterval)
  gracefulShutdownUI()
}

process.on('SIGINT', gracefulShutdown); // Ctrl+C
process.on('SIGTERM', gracefulShutdown); // kill
process.on('SIGUSR2', gracefulShutdown); // nodemon restart etc.

process.on('uncaughtException', (err: Error) => {
  logger.error('Uncaught Exception:', err);
  gracefulShutdown();
});
