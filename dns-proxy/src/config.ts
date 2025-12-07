export type UpstreamServer = {
  host: string;
  port: number;
  protocol: 'udp' | 'dot'; // DNS over UDP or DNS over TLS
  servername?: string; // TLS servername for SNI (optional, defaults to host)
};

export const defaultConfig = {
  logLevel: process.env.LOG_LEVEL || 'info',
  listenPort: envToInt(process.env.DNS_PORT, 53),
  upstreamServers: parseUpstreamServers(),
  logResolvedToFile: process.env.LOG_RESOLVED_TO_FILE || '../shared-logs/dns-proxy.log',
  hostToIpFile: process.env.HOST_TO_IP_FILE || '../host2ip.txt',
  slowDnsThresholdMs: envToInt(process.env.SLOW_DNS_THRESHOLD_MS, 1000),
  timeout: envToInt(process.env.DNS_TIMEOUT_MS, 5000),
  apiPort: envToInt(process.env.API_PORT, 3001),
  enableApi: process.env.ENABLE_API === 'true'
};

function parseUpstreamServers(): UpstreamServer[] {
  const envServers = process.env.UPSTREAM_DNS_SERVERS;

  if (envServers) {
    // Format: "udp://192.168.1.1:53,dot://1.1.1.1:853"
    return envServers.split(',').map(server => {
      const trimmed = server.trim();

      if (trimmed.startsWith('dot://')) {
        const url = trimmed.substring(6); // Remove 'dot://'
        const [hostPort, servername] = url.split('#');
        const [host, portStr] = hostPort.split(':');
        return {
          host,
          port: portStr ? parseInt(portStr, 10) : 853,
          protocol: 'dot',
          servername: servername || host
        };
      } else if (trimmed.startsWith('udp://')) {
        const url = trimmed.substring(6); // Remove 'udp://'
        const [host, portStr] = url.split(':');
        return {
          host,
          port: portStr ? parseInt(portStr, 10) : 53,
          protocol: 'udp'
        };
      } else {
        // Default to UDP if no protocol specified
        const [host, portStr] = trimmed.split(':');
        return {
          host,
          port: portStr ? parseInt(portStr, 10) : 53,
          protocol: 'udp'
        };
      }
    });
  }

  // Default to local DNS server via UDP
  return [
    { host: '192.168.1.1', port: 53, protocol: 'udp' }
  ];
}

function envToInt(something: string | undefined, defaultVal: number){
  return something ? parseInt(something, 10) : defaultVal
}
