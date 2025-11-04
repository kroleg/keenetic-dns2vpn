import fs from 'node:fs';
import readline from 'node:readline';

export interface DnsLogEntry {
  ts: string;
  clientIp: string;
  hostname: string;
  ips: string[];
}

/**
 * Read the last N unique DNS requests from the log file
 * @param logFilePath - Path to the DNS log file
 * @param limit - Maximum number of unique entries to return
 * @returns Array of unique DNS log entries, newest first
 */
export async function getLastUniqueDnsRequests(
  logFilePath: string,
  limit: number = 100
): Promise<DnsLogEntry[]> {
  const fileStream = fs.createReadStream(logFilePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const domainMap = new Map<string, DnsLogEntry>();

  for await (const line of rl) {
    if (!line.trim()) continue;

    let entry: DnsLogEntry;
    try {
      entry = JSON.parse(line);
    } catch (e) {
      console.error('Invalid JSON in DNS log:', line);
      continue;
    }

    // Store latest entry for each domain
    domainMap.set(entry.hostname, entry);
  }

  // Convert to array, sort by timestamp (newest first), and limit
  const uniqueLogs = Array.from(domainMap.values())
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, limit);

  return uniqueLogs;
}

/**
 * Match domains against patterns
 * Supports exact match and wildcard patterns (e.g., "*.example.com")
 * @param domains - Array of domain names to check
 * @param patterns - Array of patterns to match against
 * @returns Array of domains that match any pattern
 */
export function matchDomainsAgainstPatterns(
  domains: string[],
  patterns: string[]
): string[] {
  const matchedDomains: string[] = [];

  for (const domain of domains) {
    for (const pattern of patterns) {
      if (domainMatchesPattern(domain, pattern)) {
        matchedDomains.push(domain);
        break; // Move to next domain once matched
      }
    }
  }

  return matchedDomains;
}

/**
 * Check if a domain matches a pattern
 * Supports:
 * - Exact match: "example.com" matches "example.com"
 * - Wildcard: "*.example.com" matches "sub.example.com"
 * - Suffix match: "example.com" matches "sub.example.com" (contains)
 * @param domain - Domain to check
 * @param pattern - Pattern to match against
 * @returns true if domain matches pattern
 */
function domainMatchesPattern(domain: string, pattern: string): boolean {
  // Exact match
  if (domain === pattern) {
    return true;
  }

  // Wildcard pattern: *.example.com
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2); // Remove "*."
    return domain.endsWith('.' + suffix) || domain === suffix;
  }

  // Suffix match: pattern "example.com" matches "sub.example.com"
  if (domain.endsWith('.' + pattern)) {
    return true;
  }

  return false;
}

/**
 * Extract unique IPs from DNS log entries
 * @param entries - Array of DNS log entries
 * @returns Array of unique IP addresses
 */
export function extractUniqueIps(entries: DnsLogEntry[]): string[] {
  const ipSet = new Set<string>();

  for (const entry of entries) {
    for (const ip of entry.ips) {
      // Skip blocked entries (0.0.0.0) and invalid IPs
      if (ip !== '0.0.0.0' && ip) {
        ipSet.add(ip);
      }
    }
  }

  return Array.from(ipSet);
}
