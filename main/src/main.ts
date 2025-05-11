import { startFileWatcher } from "./file-watcher.js";
import { KeeneticApi } from './keenetic-api.js';
import { createLogger } from './logger.js';
import { getAllServices, type Service } from "./storage/service.repository.js";
import { runMigrations } from "./storage/db.js";
import { startUI } from "./ui/server.js";
import { matchWithoutStars, wildcardDomainMatch } from "./matcher.js";

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

// Fetch existing services
const existingServices: Service[] = await getAllServices();
logger.info(`Fetched ${existingServices.length} services from the database.`);
console.log(existingServices);
existingServices.forEach(service => {
  logger.debug(`Service ID: ${service.id}, Name: ${service.name}, Interfaces: ${service.interfaces.join(', ')}, Domains: ${service.matchingDomains.join(', ')}`);
});

const matchers: { name: string, interfaces: string[], pattern: string }[] = []
existingServices.forEach(service => {
  service.matchingDomains.forEach(pattern => {
    matchers.push({
      name: service.name,
      interfaces: service.interfaces,
      pattern: pattern,
    })
  })
})

await startFileWatcher({
  logFilePath: process.env.WATCH_FILE || 'dns-proxy.log',
  onLine: (line) => {
    try {
        const logEntry = JSON.parse(line) as { hostname: string, ips: string[] };
        if (logEntry && typeof logEntry.hostname === 'string' && Array.isArray(logEntry.ips)) {
            logger.debug(`dns query for ${logEntry.hostname} resolved to IPs: ${logEntry.ips}`);
            const match = matchers.find(m => wildcardDomainMatch(logEntry.hostname, m.pattern) || matchWithoutStars(logEntry.hostname, m.pattern));
            if (match) {
              api.addStaticRoutesForService({
                ips: logEntry.ips,
                interfaces: match.interfaces,
                comment: 'dns-auto:' + match.name + ':' + logEntry.hostname,
              }).then(resp => {
                if (resp) {
                  // todo differentiate between add and update
                  logger.info(`Adding route for ${logEntry.hostname} (${match.name}) via interfaces: ${match.interfaces.join(', ')} to IPs: ${logEntry.ips}`);
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

const { gracefulShutdown: gracefulShutdownUI } = startUI(logger);

process.on('SIGINT', gracefulShutdownUI); // Ctrl+C
process.on('SIGTERM', gracefulShutdownUI); // kill
process.on('SIGUSR2', gracefulShutdownUI); // nodemon restart etc.

process.on('uncaughtException', (err: Error) => {
  logger.error('Uncaught Exception:', err);
  gracefulShutdownUI();
});
