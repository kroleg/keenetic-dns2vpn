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
