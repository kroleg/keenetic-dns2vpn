export const defaultConfig = {
  logLevel: process.env.LOG_LEVEL || 'info',
  listenPort: 53,
  upstreamServers: [
    { host: '192.168.1.1', port: 53 },
    // { host: '8.8.4.4', port: 53 }
  ],
  logResolvedToFile: process.env.LOG_RESOLVED_TO_FILE || '../shared-logs/dns-proxy.log',
  hostToIpFile: process.env.HOST_TO_IP_FILE || '../host2ip.txt',
  slowDnsThresholdMs: envToInt(process.env.SLOW_DNS_THRESHOLD_MS, 1000),
  timeout: envToInt(process.env.DNS_TIMEOUT_MS, 5000)
};

function envToInt(something: string | undefined, defaultVal: number){
  return something ? parseInt(something, 10) : defaultVal
}
