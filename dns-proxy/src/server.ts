import { DnsProxy } from './dns-proxy.js';
import { defaultConfig } from './config.js';

async function main() {
  const server = new DnsProxy(defaultConfig);

  try {
    await server.start();

    // Handle graceful shutdown
    process.on('SIGINT', () => shutdown(server));
    process.on('SIGTERM', () => shutdown(server));
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

function shutdown(server: DnsProxy) {
  console.log('\nShutting down...');
  server.stop();
  process.exit(0);
}


main().catch(console.error);
