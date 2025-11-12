import dgram from 'node:dgram';
import type { RemoteInfo } from 'node:dgram';
import dnsPacket, { type DnsAnswer } from 'dns-packet';
import { createLogger } from './logger.js';
import { defaultConfig } from './config.js';
import fs from 'node:fs/promises';
import type { Logger } from 'winston';

export class DnsProxy {
  private server: dgram.Socket;
  private logger: Logger;
  private logResolvedToFile: string;
  private hostToIpMap: Map<string, string[]> = new Map();

  constructor(private config: typeof defaultConfig) {
    this.logger = createLogger(config.logLevel);
    this.server = dgram.createSocket('udp4');
    this.setupServer();
    this.logResolvedToFile = config.logResolvedToFile;
    // Create the log file if it doesn't exist, so on first run there will be no need to manually create it
    fs.writeFile(this.logResolvedToFile, '');
    // Load host-to-IP mapping
    this.loadHostToIpMap();
  }

  private async loadHostToIpMap() {
    try {
      const file = await fs.readFile(this.config.hostToIpFile, 'utf-8');
      this.hostToIpMap.clear();
      for (const line of file.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const [host, ...ips] = trimmed.split(/\s+/);
        if (host && ips.length > 0) {
          this.hostToIpMap.set(host, ips);
        }
      }
      this.logger.info(`Loaded host-to-IP map from ${this.config.hostToIpFile}`);
    } catch (err) {
      this.logger.warn(`Could not load host-to-IP map: ${err}`);
    }
  }

  private async logResolvedHost(params: { clientIp: string, hostname: string, ips: string[] }) {
    const { clientIp, hostname, ips } = params;
    const logEntry = JSON.stringify({ ts: new Date().toISOString(), clientIp, hostname, ips }) + '\n';
    try {
      await fs.appendFile(this.logResolvedToFile, logEntry);
      this.logger.debug('Logged to file:', { hostname, ips });
    } catch (error) {
      this.logger.error('Error writing to log file:', error);
    }
  }

  private setupServer() {
    this.server.on('error', (err: Error) => {
      this.logger.error('Server error:', err);
    });

    this.server.on('message', async (msg: Buffer, rinfo: RemoteInfo) => {
      try {
        const response = await this.handleDnsRequest(msg, rinfo.address);
        this.server.send(response, rinfo.port, rinfo.address);
      } catch (error) {
        this.logger.error('Error handling DNS request:', error);
      }
    });
  }

  private async handleDnsRequest(msg: Buffer, clientIp: string): Promise<Buffer> {
    const startTime = Date.now()
    const query = dnsPacket.decode(msg);
    const question = query.questions[0];

    if (!question) {
      throw new Error('No question in DNS query');
    }

    if (question.type === 'A') this.logger.debug('DNS query:', {
      type: question.type,
      name: question.name,
      class: question.class
    });

    // Check host-to-IP map first
    const mappedIps = this.hostToIpMap.get(question.name);
    if (question.type === 'A' && mappedIps) {
      // Build DNS response
      const response = dnsPacket.encode({
        id: query.id,
        type: 'response',
        flags: 0x8180, // Standard response with recursion available
        questions: [question],
        answers: mappedIps.map(ip => ({
          type: 'A',
          name: question.name,
          ttl: 300,
          class: 'IN',
          data: ip
        }))
      });
      this.logger.info(`client: ${clientIp} query: ${question.name} response (local): ${mappedIps}`);
      await this.logResolvedHost({ clientIp, hostname: question.name, ips: mappedIps });
      return response;
    }

    // Create a UDP client for the upstream server
    const client = dgram.createSocket('udp4');
    const upstreamServer = this.config.upstreamServers[0]; // TODO: Implement round-robin

    try {
      const response = await new Promise<Buffer>((resolve, reject) => {
        client.on('error', reject);
        client.on('message', (response: Buffer) => {
          resolve(response);
          client.close();
        });

        client.send(msg, upstreamServer.port, upstreamServer.host);

        // TODO: Implement timeout
        // // Set timeout
        // setTimeout(() => {
        //   client.close();
        //   reject(new Error('DNS request timeout'));
        // }, this.config.timeout);
      });

      const decodedResponse = dnsPacket.decode(response);

      // Log raw response for debugging
      this.logger.debug('DNS response:', {
        type: decodedResponse.type,
        flags: decodedResponse.flags,
        answers: decodedResponse.answers.map(a => ({
          type: a.type,
          name: a.name,
          ttl: a.ttl,
          data: a.data
        }))
      });

      const resolvedIps = decodedResponse.answers
        .filter((a: DnsAnswer) => a.type === 'A' /*|| a.type === 'AAAA'*/) // ignore ipv6 for now
        .map((a: DnsAnswer) => a.data.toString());

      if (resolvedIps.length > 0) {
        this.logger.info(`client: ${clientIp} query: ${question.name} response: ${resolvedIps}`);
        const logStartTime = Date.now()
        await this.logResolvedHost({ clientIp, hostname: question.name, ips: resolvedIps });
        this.logIfSlow(logStartTime, 15, 'Slow logResolvedHost')
      }

      this.logIfSlow(startTime, this.config.slowDnsThresholdMs, `SLOW RESP: ${ question.name }`)
      return response;

    } catch (error) {
      throw error;
    }
  }

  logIfSlow(start: number, threshold: number, label: string) {
    const tookMs = Date.now() - start
    if (tookMs > threshold) {
      console.error(`${label} took ${tookMs}`)
    }
  }

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.bind(this.config.listenPort, () => {
        this.logger.info(`DNS server listening on port ${this.config.listenPort}`);
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        this.logger.info('DNS server stopped');
        resolve();
      });
    });
  }
}
