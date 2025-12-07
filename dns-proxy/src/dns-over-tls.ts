import tls from 'node:tls';
import type { UpstreamServer } from './config.js';
import type { Logger } from 'winston';

export class DnsOverTlsClient {
  constructor(private logger: Logger) {}

  /**
   * Send a DNS query over TLS to an upstream server
   * @param query The DNS query buffer
   * @param server The upstream server configuration
   * @param timeout Timeout in milliseconds
   * @returns The DNS response buffer
   */
  async query(query: Buffer, server: UpstreamServer, timeout: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | null = null;
      let responseBuffer = Buffer.alloc(0);
      let expectedLength: number | null = null;

      // Create TLS connection
      const socket = tls.connect({
        host: server.host,
        port: server.port,
        servername: server.servername || server.host,
        // Reject unauthorized certificates by default for security
        rejectUnauthorized: true,
        // Optional: Add custom CA if needed
        // ca: [fs.readFileSync('path/to/ca.pem')]
      });

      socket.on('secureConnect', () => {
        this.logger.debug(`TLS connection established to ${server.host}:${server.port}`);

        // DNS over TLS uses a 2-byte length prefix before the DNS message
        const lengthPrefix = Buffer.allocUnsafe(2);
        lengthPrefix.writeUInt16BE(query.length, 0);
        const message = Buffer.concat([lengthPrefix, query]);

        socket.write(message);
      });

      socket.on('data', (data: Buffer) => {
        responseBuffer = Buffer.concat([responseBuffer, data]);

        // Read the expected length from the first 2 bytes
        if (expectedLength === null && responseBuffer.length >= 2) {
          expectedLength = responseBuffer.readUInt16BE(0);
        }

        // Check if we've received the complete response
        if (expectedLength !== null && responseBuffer.length >= expectedLength + 2) {
          if (timeoutId) clearTimeout(timeoutId);

          // Extract the DNS message (skip the 2-byte length prefix)
          const dnsMessage = responseBuffer.subarray(2, expectedLength + 2);
          socket.end();
          resolve(dnsMessage);
        }
      });

      socket.on('error', (error: Error) => {
        if (timeoutId) clearTimeout(timeoutId);
        this.logger.error(`TLS connection error to ${server.host}:${server.port}:`, error);
        socket.destroy();
        reject(error);
      });

      socket.on('end', () => {
        if (timeoutId) clearTimeout(timeoutId);
        if (expectedLength === null || responseBuffer.length < expectedLength + 2) {
          const error = new Error('Connection closed before receiving complete response');
          reject(error);
        }
      });

      socket.on('timeout', () => {
        if (timeoutId) clearTimeout(timeoutId);
        socket.destroy();
        reject(new Error(`TLS connection timeout after ${timeout}ms`));
      });

      // Set timeout
      timeoutId = setTimeout(() => {
        socket.destroy();
        reject(new Error(`DNS over TLS request timeout after ${timeout}ms`));
      }, timeout);
    });
  }
}
