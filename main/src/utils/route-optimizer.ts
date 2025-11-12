/**
 * Route Optimization Utilities
 *
 * Optimizes VPN routes by aggregating multiple host routes into network routes
 * where possible (max /22 subnet mask).
 */

interface Route {
  network?: string;
  mask?: string;
  host?: string;
  interface: string;
  comment: string;
  gateway?: string;
  metric?: number;
  auto?: boolean;
}

interface OptimizedRoute {
  network: string;
  mask: string;
  interface: string;
  comment: string;
  gateway?: string;
  metric?: number;
  auto?: boolean;
}

/**
 * Converts an IP address string to a 32-bit integer
 */
function ipToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

/**
 * Converts a 32-bit integer back to an IP address string
 */
function intToIp(int: number): string {
  return [
    (int >>> 24) & 0xff,
    (int >>> 16) & 0xff,
    (int >>> 8) & 0xff,
    int & 0xff
  ].join('.');
}

/**
 * Converts CIDR prefix length to subnet mask
 */
function prefixToMask(prefix: number): string {
  const mask = ~((1 << (32 - prefix)) - 1);
  return intToIp(mask >>> 0);
}

/**
 * Calculates network address from IP and prefix
 */
function getNetworkAddress(ip: string, prefix: number): string {
  const ipInt = ipToInt(ip);
  const maskInt = ~((1 << (32 - prefix)) - 1);
  const networkInt = ipInt & maskInt;
  return intToIp(networkInt >>> 0);
}

/**
 * Checks if an IP belongs to a network/mask
 */
function ipInNetwork(ip: string, network: string, mask: string): boolean {
  const ipInt = ipToInt(ip);
  const networkInt = ipToInt(network);
  const maskInt = ipToInt(mask);

  return (ipInt & maskInt) === (networkInt & maskInt);
}

/**
 * Groups routes by interface and extracts IPs
 */
function groupRoutesByInterface(routes: Route[]): Map<string, Set<string>> {
  const grouped = new Map<string, Set<string>>();

  for (const route of routes) {
    if (!route.host) continue; // Only process host routes

    if (!grouped.has(route.interface)) {
      grouped.set(route.interface, new Set());
    }
    grouped.get(route.interface)!.add(route.host);
  }

  return grouped;
}

/**
 * Tries to find the optimal subnet (from /22 to /30) that contains the most IPs
 */
function findOptimalSubnet(ips: string[], minPrefix: number = 22, maxPrefix: number = 30): {
  network: string;
  prefix: number;
  mask: string;
  ips: string[];
} | null {
  const ipInts = ips.map(ipToInt).sort((a, b) => a - b);

  let bestResult: {
    network: string;
    prefix: number;
    mask: string;
    ips: string[];
  } | null = null;
  let maxCoverage = 1; // Only worth it if we cover at least 2 IPs

  // Try each IP as a potential network base
  for (const baseIp of ips) {
    // Try different prefix lengths from /22 (most aggregation) to /30 (least)
    for (let prefix = minPrefix; prefix <= maxPrefix; prefix++) {
      const network = getNetworkAddress(baseIp, prefix);
      const mask = prefixToMask(prefix);

      // Count how many IPs from our list fit in this subnet
      const coveredIps = ips.filter(ip => ipInNetwork(ip, network, mask));

      if (coveredIps.length > maxCoverage) {
        maxCoverage = coveredIps.length;
        bestResult = {
          network,
          prefix,
          mask,
          ips: coveredIps
        };
      }
    }
  }

  return bestResult;
}

/**
 * Optimizes a list of routes by aggregating host routes into network routes
 *
 * @param routes - Array of routes to optimize
 * @param serviceCommentPrefix - Comment prefix to identify routes belonging to a service (e.g., "dns-auto:serviceName")
 * @returns Object containing optimized routes and routes to remove
 */
export function optimizeRoutes(routes: Route[], serviceCommentPrefix: string): {
  routesToAdd: OptimizedRoute[];
  routesToRemove: Route[];
} {
  // Filter routes belonging to this service (host routes only)
  const serviceRoutes = routes.filter(
    r => r.host && r.comment.startsWith(serviceCommentPrefix)
  );

  if (serviceRoutes.length < 2) {
    // Not enough routes to optimize
    return { routesToAdd: [], routesToRemove: [] };
  }

  // Group routes by interface
  const routesByInterface = groupRoutesByInterface(serviceRoutes);

  const routesToAdd: OptimizedRoute[] = [];
  const routesToRemove: Route[] = [];

  // Process each interface separately
  for (const [iface, ipsSet] of routesByInterface.entries()) {
    let remainingIps = Array.from(ipsSet);

    // Keep finding optimal subnets until we can't aggregate anymore
    while (remainingIps.length >= 2) {
      const subnet = findOptimalSubnet(remainingIps);

      if (!subnet || subnet.ips.length < 2) {
        // Can't aggregate remaining IPs
        break;
      }

      // Create optimized network route
      routesToAdd.push({
        network: subnet.network,
        mask: subnet.mask,
        interface: iface,
        comment: `${serviceCommentPrefix}:optimized/${subnet.prefix}`,
        auto: true
      });

      // Mark covered host routes for removal
      const coveredRoutes = serviceRoutes.filter(
        r => r.interface === iface && r.host && subnet.ips.includes(r.host)
      );
      routesToRemove.push(...coveredRoutes);

      // Remove covered IPs from remaining list
      remainingIps = remainingIps.filter(ip => !subnet.ips.includes(ip));
    }
  }

  return { routesToAdd, routesToRemove };
}

/**
 * Calculates optimization statistics
 */
export function calculateOptimizationStats(routesToAdd: OptimizedRoute[], routesToRemove: Route[]): {
  originalCount: number;
  optimizedCount: number;
  reduction: number;
  reductionPercent: number;
} {
  const originalCount = routesToRemove.length;
  const optimizedCount = routesToAdd.length;
  const reduction = originalCount - optimizedCount;
  const reductionPercent = originalCount > 0 ? (reduction / originalCount) * 100 : 0;

  return {
    originalCount,
    optimizedCount,
    reduction,
    reductionPercent: Math.round(reductionPercent * 100) / 100
  };
}

/**
 * Checks if an IP address is already covered by existing optimized routes
 *
 * @param ip - The IP address to check
 * @param routes - Array of all routes to check against
 * @param serviceCommentPrefix - Comment prefix to identify routes belonging to a service
 * @returns True if the IP is covered by an optimized route, false otherwise
 */
export function isIpCoveredByOptimizedRoutes(
  ip: string,
  routes: Route[],
  serviceCommentPrefix: string
): boolean {
  // Filter optimized network routes for this service
  const optimizedRoutes = routes.filter(
    r => r.network && r.mask && r.comment.startsWith(serviceCommentPrefix) && r.comment.includes(':optimized/')
  );

  // Check if IP fits into any of the optimized network routes
  for (const route of optimizedRoutes) {
    if (route.network && route.mask && ipInNetwork(ip, route.network, route.mask)) {
      return true;
    }
  }

  return false;
}

/**
 * Filters out IPs that are already covered by existing optimized routes
 *
 * @param ips - Array of IPs to filter
 * @param routes - Array of all routes to check against
 * @param serviceCommentPrefix - Comment prefix to identify routes belonging to a service
 * @returns Object with covered IPs and uncovered IPs that need to be added
 */
export function filterIpsCoveredByOptimizedRoutes(
  ips: string[],
  routes: Route[],
  serviceCommentPrefix: string
): {
  coveredIps: string[];
  uncoveredIps: string[];
} {
  const coveredIps: string[] = [];
  const uncoveredIps: string[] = [];

  for (const ip of ips) {
    if (isIpCoveredByOptimizedRoutes(ip, routes, serviceCommentPrefix)) {
      coveredIps.push(ip);
    } else {
      uncoveredIps.push(ip);
    }
  }

  return { coveredIps, uncoveredIps };
}
