import { describe, it, expect } from 'vitest';
import { DnsOverTlsClient } from './dns-over-tls.js';
import { createLogger } from './logger.js';
import dnsPacket from 'dns-packet';
import type { UpstreamServer } from './config.js';

describe('DnsOverTlsClient', () => {
  const logger = createLogger('error'); // Use error level to suppress logs during tests
  const client = new DnsOverTlsClient(logger);

  it('should successfully query Google DNS over TLS for example.com', async () => {
    // Create a DNS query for example.com
    const query = dnsPacket.encode({
      type: 'query',
      id: 1,
      flags: dnsPacket.RECURSION_DESIRED,
      questions: [{
        type: 'A',
        name: 'example.com'
      }]
    });

    const server: UpstreamServer = {
      host: 'dns.google',
      port: 853,
      protocol: 'dot',
      servername: 'dns.google'
    };

    // Query should complete within 5 seconds
    const response = await client.query(query, server, 5000);

    // Decode and verify response
    const decoded = dnsPacket.decode(response);
    expect(decoded.type).toBe('response');
    expect(decoded.answers.length).toBeGreaterThan(0);

    // Check that we got an A record answer
    const aRecords = decoded.answers.filter(a => a.type === 'A');
    expect(aRecords.length).toBeGreaterThan(0);
  }, 10000); // 10 second timeout for the test

  it('should handle timeout errors', async () => {
    const query = dnsPacket.encode({
      type: 'query',
      id: 3,
      flags: dnsPacket.RECURSION_DESIRED,
      questions: [{
        type: 'A',
        name: 'example.com'
      }]
    });

    const server: UpstreamServer = {
      host: 'dns.google',
      port: 853,
      protocol: 'dot',
      servername: 'dns.google'
    };

    // Very short timeout should cause an error
    await expect(
      client.query(query, server, 1)
    ).rejects.toThrow(/timeout/i);
  });
});
