import dgram from 'node:dgram';
import type { RemoteInfo } from 'node:dgram';
import dnsPacket, { type DnsAnswer } from 'dns-packet';
import { createLogger } from './logger.js';
import { defaultConfig } from './config.js';
import type { UpstreamServer } from './config.js';
import fs from 'node:fs/promises';
import type { Logger } from 'winston';
import { DnsRequestLogger } from './db.js';
import { DnsOverTlsClient } from './dns-over-tls.js';

export class DnsProxy {
  private server: dgram.Socket;
  private logger: Logger;
  private logResolvedToFile: string;
  private hostToIpMap: Map<string, string[]> = new Map();
  private dbLogger: DnsRequestLogger;
  private dotClient: DnsOverTlsClient;

  constructor(private config: typeof defaultConfig) {
    this.logger = createLogger(config.logLevel);
    this.server = dgram.createSocket('udp4');
    this.dbLogger = new DnsRequestLogger(this.logger);
    this.dotClient = new DnsOverTlsClient(this.logger);
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

    // Log pending request to database
    const requestId = await this.dbLogger.logPendingRequest(clientIp, question.name, question.type);

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
      const responseTime = Date.now() - startTime;
      this.logger.info(`client: ${clientIp} query: ${question.name} response (local): ${mappedIps}`);
      await this.logResolvedHost({ clientIp, hostname: question.name, ips: mappedIps });
      await this.dbLogger.updateResolved(requestId, mappedIps, responseTime);
      return response;
    }

    // Get upstream server (TODO: Implement round-robin)
    const upstreamServer = this.config.upstreamServers[0];

    try {
      // Query upstream server based on protocol
      const response = await this.queryUpstream(msg, upstreamServer);

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

      const responseTime = Date.now() - startTime;
      await this.dbLogger.updateResolved(requestId, resolvedIps, responseTime);
      this.logIfSlow(startTime, this.config.slowDnsThresholdMs, `SLOW RESP: ${ question.name }`)
      return response;

    } catch (error) {
      const responseTime = Date.now() - startTime;
      let errorMessage = 'Unknown error';

      if (error instanceof Error && error.message.includes('timeout')) {
        errorMessage = `Timeout after ${this.config.timeout}ms`;
        this.logger.warn(`DNS request timeout for ${question.name} after ${this.config.timeout}ms`);
      } else {
        errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`DNS request error for ${question.name}:`, error);
      }

      await this.dbLogger.updateFailed(requestId, errorMessage, responseTime);

      // Return DNS SERVFAIL response
      const servfailResponse = dnsPacket.encode({
        id: query.id,
        type: 'response',
        flags: 0x8182, // SERVFAIL: Server failure (0x8180 | 0x0002)
        questions: [question],
        answers: []
      });

      return servfailResponse;
    }
  }

  logIfSlow(start: number, threshold: number, label: string) {
    const tookMs = Date.now() - start
    if (tookMs > threshold) {
      this.logger.warn(`${label} took ${tookMs}`)
    }
  }

  private async queryUpstream(query: Buffer, server: UpstreamServer): Promise<Buffer> {
    if (server.protocol === 'dot') {
      // Use DNS over TLS
      this.logger.debug(`Querying upstream via DoT: ${server.host}:${server.port}`);
      return await this.dotClient.query(query, server, this.config.timeout);
    } else {
      // Use plain DNS over UDP
      this.logger.debug(`Querying upstream via UDP: ${server.host}:${server.port}`);
      return await this.queryUpstreamUdp(query, server);
    }
  }

  private async queryUpstreamUdp(msg: Buffer, upstreamServer: UpstreamServer): Promise<Buffer> {
    const client = dgram.createSocket('udp4');

    return new Promise<Buffer>((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | null = null;

      client.on('error', (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        reject(error);
      });

      client.on('message', (response: Buffer) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve(response);
        client.close();
      });

      client.send(msg, upstreamServer.port, upstreamServer.host);

      timeoutId = setTimeout(() => {
        client.close();
        reject(new Error(`DNS request timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);
    });
  }

  public async start(): Promise<void> {
    // Initialize database connection
    await this.dbLogger.initialize();

    return new Promise((resolve) => {
      this.server.bind(this.config.listenPort, () => {
        this.logger.info(`DNS server listening on port ${this.config.listenPort}`);
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(async () => {
        this.logger.info('DNS server stopped');
        await this.dbLogger.close();
        resolve();
      });
    });
  }
}
