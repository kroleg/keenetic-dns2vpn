export const defaultConfig = {
  logLevel: process.env.LOG_LEVEL || 'info',
  listenPort: 53,
  upstreamServers: [
    { host: '192.168.1.1', port: 53 },
    // { host: '8.8.4.4', port: 53 }
  ],
  logResolvedToFile: process.env.LOG_RESOLVED_TO_FILE || 'dns-proxy.log',
  // timeout: 5000,
};
