# DNS Proxy

A TypeScript-based DNS proxy that forwards DNS requests to specified DNS servers and provides detailed resolution information in JSON format.

## Development Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the project:
   ```bash
   npm run build
   ```

3. Run tests:
   ```bash
   npm test
   ```

4. Start the server:
   ```bash
   npm start
   ```

### Manual testing
1. Start local server `npm start`)
2. Use `dig`
  ```sh
  dig xp.apple.com @127.0.0.1
  dig chatgpt.com @127.0.0.1
  ```

## Requirements

### Technical Stack
- Node.js (latest LTS version)
- TypeScript
- Vitest for testing
- DNS packet parsing library (e.g., `dns-packet`)

### Core Features

2. Response Processing
   - Parse DNS responses
   - Extract and format the following information:
     - Hostname
     - All resolved IP addresses
     - TTL values (todo)

3. Output Format
   ```json
   {
      "hostname": "example.com",
      "resolvedIPs": [ "93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"],
      "ttl": 300
   }
   ```

### Configuration

The DNS proxy can be configured using environment variables:

- `UPSTREAM_DNS_SERVERS` - Comma-separated list of upstream DNS servers with protocol specification
  - Format: `protocol://host:port`
  - Supported protocols: `udp`, `dot` (DNS over TLS)
  - Examples:
    - `udp://192.168.1.1:53` - Plain DNS over UDP
    - `dot://1.1.1.1:853` - DNS over TLS (Cloudflare)
    - `dot://8.8.8.8:853#dns.google` - DNS over TLS with custom servername for SNI
  - Default: `udp://192.168.1.1:53`

- `DNS_TIMEOUT_MS` - DNS query timeout in milliseconds (default: 5000)
- `LOG_LEVEL` - Logging level: debug, info, warn, error (default: info)
- `LOG_RESOLVED_TO_FILE` - Path to file for resolved domain logs
- `HOST_TO_IP_FILE` - Path to custom host-to-IP mapping file
- `SLOW_DNS_THRESHOLD_MS` - Threshold for slow DNS warnings (default: 1000ms)

Example configuration for DNS over TLS:
```bash
UPSTREAM_DNS_SERVERS="dot://1.1.1.1:853#cloudflare-dns.com,dot://8.8.8.8:853#dns.google"
```

- Configurable listening port (default: 53)
- Optional configuration for:
  - Response caching

### Testing Requirements
- Unit tests for:
  - Response formatting
  - Error handling
- Integration tests for:
  - End-to-end DNS resolution
  - Multiple upstream server handling
  - CNAME resolution chain

### Error Handling
- Invalid DNS requests
- Upstream server failures
- Timeout handling
- Malformed responses
- Network errors

### Performance Considerations
- Efficient packet parsing
- Minimal memory footprint
- Support for concurrent requests

### Security
- Input validation

## Project Structure
```
src/ # Code
tests/
├── unit/          # Unit tests
└── integration/   # Integration tests
```

## Future Enhancements
- dockerize
- web ui to modify list of domains to log
- Round-robin or failover configuration for multiple servers
- Support multiple upstream DNS servers
