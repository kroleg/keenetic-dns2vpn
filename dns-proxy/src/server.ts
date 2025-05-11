import { DnsProxy } from './dns-proxy.js';
import { defaultConfig } from './config.js';

async function main() {
  const server = new DnsProxy(defaultConfig);

  try {
    await server.start();

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\nShutting down...');
      await server.stop();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

main().catch(console.error);
