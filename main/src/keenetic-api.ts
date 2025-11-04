import crypto from 'crypto';
import type { Logger } from 'winston';

export class KeeneticApi {
    private host: string;
    private cookies = '';
    private login: string;
    private password: string;
    private logger: Logger;

    constructor({ host, login, password, logger }: { host: string, login: string, password: string, logger: Logger }) {
        if (!host || !login || !password) {
            throw new Error('host, login, and password are required');
        }
        this.host = host;
        this.login = login;
        this.password = password;
        this.logger = logger;
    }

    async getSystemInfo(): Promise<unknown> {
        await this.ensureAuthenticated();
        try {
            // Ensure KEENETIC_HOST is defined before this call too, though ensureAuthenticated should catch it.
            const response = await this.getWithAuth('/rci/show/system');
            if (response.status === 200) {
                // console.log('System info retrieved successfully:', response.data);
                return response.data;
            }
            this.logger.error(`Failed to get system info. Status: ${response.status}, Data: ${JSON.stringify(response.data)}`);
            return null;

        } catch (error) {
            this.logger.error('Error fetching system info:', error);
            return null;
        }
    }

    // todo remove if not used. Kept for reference.
    async addStaticRoute(
        routeParams: {
            network?: string;
            mask?: string;
            host?: string;
            interfaceId: string;
            comment: string;
        }
    ) {
        const { network, mask, host, interfaceId, comment } = routeParams;

        const routeCommand: any = {
            ip: {
                route: {
                    interface: interfaceId,
                    auto: true,
                    comment,
                },
            },
        };

        if (network && mask) {
            routeCommand.ip.route.network = network;
            routeCommand.ip.route.mask = mask;
        } else if (host) {
            routeCommand.ip.route.host = host;
        } else {
            throw new Error("Either network and mask, or host must be provided.");
        }

        const payload = [
            {
                webhelp: { event: { push: { data: JSON.stringify({ type: "configuration_change", value: { url: "/staticRoutes" } }) } } }
            },
            routeCommand,
            { system: { configuration: { save: {} } } }
        ];

        const result = await this.postWithAuth('/rci/', payload);
        const { status } = (result.data as any)[1].ip.route;
        if (status[0].status === 'message') {
            this.logger.debug(status[0].message);
            return true;
        }
        this.logger.debug(status);
        this.logger.error(status[0].message);
        return false;
    }

    async addStaticRoutesForService(
      service: {
        ips: string[];
        interfaces: string[];
        comment: string;
        network?: string;
        mask?: string;
      }
    ) {
      const payloadPrefix = {
        webhelp: { event: { push: { data: JSON.stringify({ type: "configuration_change", value: { url: "/staticRoutes" } }) } } }
      }
      const payloadSuffix = { system: { configuration: { save: {} } } }
      const { interfaces, ips: hosts, comment, network, mask } = service

      // If network and mask are provided, add network route instead of host routes
      const commands = network && mask
        ? (interfaces || ['Wireguard0']).map(iface => ({
            ip: { route: { network, mask, interface: iface, auto: true, comment } }
          }))
        : hosts.flatMap(host => {
            return (interfaces || ['Wireguard0']).map(iface => {
              return {
                  ip: { route: { host, interface: iface, auto: true, comment, }, },
              };
            })
          });

      const result = await this.postWithAuth('/rci/', [
        payloadPrefix,
        ...commands,
        payloadSuffix,
      ]);
      this.logger.debug('full response: ' + JSON.stringify(result.data));
      return (result.data as any[]).slice(1,-1).map(command => {
        const { status } = command.ip.route;
        const messages = status.map((s:any) => s.message).join('; ');
        this.logger.debug(messages)
        return messages;
      });
    }

    async postWithAuth(path: string, body: unknown): Promise<{
        status: number;
        headers: Record<string, string>;
        data: unknown;
    }> {
        await this.ensureAuthenticated();
        return this.postRequest(path, body);
    }

    async getWithAuth(path: string): Promise<{
        status: number;
        headers: Record<string, string>;
        data: unknown;
    }> {
        await this.ensureAuthenticated();
        return this.getRequest(path);
    }

    private async getRequest(path: string): Promise<{
        status: number;
        headers: Record<string, string>;
        data: unknown;
    }> {
        this.logger.debug(`Executing GET ${this.host}${path} with ${this.cookies ? 'cookies' : 'no cookies'}`);
        const requestOptions: RequestInit = {
            method: 'GET',
            headers: {},
        };
        if (this.cookies) {
            (requestOptions.headers as Record<string, string>)['Cookie'] = this.cookies;
        }

        try {
            const response = await fetch(`${this.host}${path}`, requestOptions);
            const responseHeaders = getHeadersFromFetchResponse(response.headers);
            let responseData;
            try {
                // Attempt to parse JSON, but don't fail if body is empty or not JSON
                const text = await response.text();
                if (text) {
                    responseData = JSON.parse(text);
                }
            } catch (e) {
                // console.warn('Could not parse JSON response for GET', path, e);
                responseData = null; // Or handle as text if necessary
            }

            return {
                status: response.status,
                headers: responseHeaders,
                data: responseData,
            };
        } catch (error) {
            this.logger.error(`Error during GET request to ${this.host}${path}:`, error);
            return { status: 500, headers: {}, data: { error: (error as Error).message } };
        }
    }

    private async postRequest(path: string, body: unknown): Promise<{
        status: number;
        headers: Record<string, string>;
        data: unknown;
    }> {
        this.logger.debug(`Executing POST ${this.host}${path} with body: ${JSON.stringify(body)} and cookies: ${this.cookies}`);
        const requestOptions: RequestInit = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify(body),
        };
        if (this.cookies) {
            (requestOptions.headers as Record<string, string>)['Cookie'] = this.cookies;
        }

        try {
            const response = await fetch(`${this.host}${path}`, requestOptions);
            const responseHeaders = getHeadersFromFetchResponse(response.headers);
            let responseData;
            try {
                const text = await response.text();
                if (text) {
                    responseData = JSON.parse(text);
                }
            } catch (e) {
                // console.warn('Could not parse JSON response for POST', path, e);
                responseData = null;
            }

            return {
                status: response.status,
                headers: responseHeaders,
                data: responseData,
            };
        } catch (error) {
            this.logger.error(`Error during POST request to ${this.host}${path}:`, error);
            return { status: 500, headers: {}, data: { error: (error as Error).message } };
        }
    }

    async performLogin(realm: string, challenge: string): Promise<boolean> {
        if (!this.login || !this.password) {
            this.logger.error('Keenetic login credentials are not set in environment variables.');
            return false;
        }

        const md5Hash = md5(`${this.login}:${realm}:${this.password}`);
        const finalPasswordHash = sha256(`${challenge}${md5Hash}`);

        const loginPayload = {
            login: this.login,
            password: finalPasswordHash,
        };

        try {
            const response = await this.postRequest('/auth', loginPayload);

            if (response.status === 200) {
                this.logger.debug('Login successful.');
                return true;
            } else {
                this.logger.error(`Login failed. Status: ${response.status}, Data: ${JSON.stringify(response.data)}`);
                return false;
            }
        } catch (error) {
            this.logger.error('Error during login POST request:', error);
            return false;
        }
    }


    async ensureAuthenticated(): Promise<boolean> {
        try {
            const authCheckResponse = await this.getRequest('/auth');

            if (authCheckResponse.status === 200) {
                this.logger.debug('Session is active.');
                return true;
            }
            if (authCheckResponse.status === 401) {
                this.logger.debug('Session not active or invalid. Proceeding to login.');
                // Headers from fetch are typically lowercase
                const realm = authCheckResponse.headers['x-ndm-realm'];
                const challenge = authCheckResponse.headers['x-ndm-challenge'];

                if (!realm || !challenge) {
                    this.logger.error('Missing X-NDM-Realm or X-NDM-Challenge in 401 response headers:', authCheckResponse.headers);
                    return false;
                }
                this.cookies = authCheckResponse.headers['set-cookie'];
                return await this.performLogin(realm, challenge);
            }
            this.logger.error(`Unexpected status code during auth check: ${authCheckResponse.status}, Body: ${JSON.stringify(authCheckResponse.data)}`);
            return false;
        } catch (error) {
            this.logger.error('Error during authentication check:', error);
            return false;
        }
    }

  async getInterfaces(types: string[] = ['Wireguard']): Promise<
    {
      id: string,
      name: string,
      type: string,
      connected: boolean
    }[]
  > {
    const { data } = await this.getWithAuth('/rci/show/interface');
    const facesWithTypes = Object.values(data as any).filter((i: any) => types.includes(i.type))
    return facesWithTypes.map(({ id, type, description: name, connected: connectedYesNo }: any) => ({ id, name, type, connected: connectedYesNo == 'yes'  }));
  }

  async getRoutes(): Promise<{
    network?: string;
    mask?: string;
    host?: string;
    interface: string;
    comment: string;
    gateway?: string;
    metric?: number;
    auto?: boolean;
  }[]> {
    await this.ensureAuthenticated();
    try {
      const response = await this.postWithAuth('/rci/', [{
        show: {
          sc: {
            ip: {
              route: {}
            }
          }
        }
      }]);

      if (response.status === 200 && Array.isArray(response.data)) {
        const routesData = response.data[0]?.show?.sc?.ip?.route as Record<string, {
          network?: string;
          mask?: string;
          host?: string;
          interface: string;
          comment: string;
          gateway?: string;
          metric?: number;
          auto?: boolean;
        }>;
        if (routesData) {
          return Object.values(routesData).map(route => ({
            network: route.network,
            mask: route.mask,
            host: route.host,
            interface: route.interface,
            comment: route.comment,
            gateway: route.gateway,
            metric: route.metric,
            auto: route.auto
          }));
        }
      }
      this.logger.error(`Failed to get routes. Status: ${response.status}, Data: ${JSON.stringify(response.data)}`);
      return [];
    } catch (error) {
      this.logger.error('Error fetching routes:', error);
      return [];
    }
  }

  async getClients(): Promise<{
    name: string;
    ip: string;
    policy?: string;
  }[]> {
    await this.ensureAuthenticated();
    try {
      const response = await this.getWithAuth('/rci/show/ip/hotspot/host');
      if (response.status === 200 && Array.isArray(response.data)) {
        return response.data
          .filter((client: any) => client.ip !== '0.0.0.0')
          .map((client: any) => ({
            name: client.name || 'Unknown',
            ip: client.ip || '',
            policy: (client.policy || client.classifier || client["ip-policy"] || client.connection_policy || '').toString() || undefined,
          }));
      }
      this.logger.error(`Failed to get clients. Status: ${response.status}, Data: ${JSON.stringify(response.data)}`);
      return [];
    } catch (error) {
      this.logger.error('Error fetching clients:', error);
      return [];
    }
  }

  async getClientsPolicies(): Promise<Record<string, any>> {
    await this.ensureAuthenticated();
    try {
      const response = await this.getWithAuth('/rci/rc/show/ip/hotspot/host');
      if (response.status === 200) {
        console.dir(response, {depth:null})
        return (response.data as Record<string, any>) || {};
      }
      this.logger.error(`Failed to get client policies. Status: ${response.status}, Data: ${JSON.stringify(response.data)}`);
      return {};
    } catch (error) {
      this.logger.error('Error fetching client policies:', error);
      return {};
    }
  }

  async removeRoutesByCommentPrefix(commentPrefix: string): Promise<boolean> {
    await this.ensureAuthenticated();
    try {
      const routes = await this.getRoutes();
      const routesToRemove = routes.filter(route => route.comment.startsWith(commentPrefix));

      if (routesToRemove.length === 0) {
        this.logger.debug(`No routes found with comment prefix: ${commentPrefix}`);
        return true;
      }

      const payloadPrefix = {
        webhelp: { event: { push: { data: JSON.stringify({ type: "configuration_change", value: { url: "/staticRoutes" } }) } } }
      };
      const payloadSuffix = { system: { configuration: { save: {} } } };

      const commands = routesToRemove.map(route => ({
        ip: {
          route: {
            no: true,
            ...(route.network && route.mask ? {
              network: route.network,
              mask: route.mask
            } : {
              host: route.host
            }),
            comment: route.comment
          }
        }
      }));

      const result = await this.postWithAuth('/rci/', [
        payloadPrefix,
        ...commands,
        payloadSuffix
      ]);

      this.logger.debug('Route removal response:', JSON.stringify(result.data));
      return true;
    } catch (error) {
      this.logger.error('Error removing routes:', error);
      return false;
    }
  }

}


function md5(data: string): string {
    return crypto.createHash('md5').update(data).digest('hex');
}

function sha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

// Helper to extract headers from fetch Response into our AuthHeadersFromFetch format
function getHeadersFromFetchResponse(responseHeaders: Headers): Record<string, string> {
    const headers: Record<string, string> = {};
    responseHeaders.forEach((value, key) => {
        headers[key.toLowerCase()] = value; // Normalize keys to lowercase
    });
    return headers;
}
