# VPN Routes management

## Features

- watching dns proxy logs and adding matching hostnames to vpn routes in keenetic
- UI for managing hostname matching rules
- list of dns requests by IP (to find weird domains used like for brawlstars)
  - needs dns-proxy to pass ip of client

### TODO
- [ ] single repo to host dns-proxy and watcher
- [ ] should work for multiple IPs resolved (currently only first one passed)
- [ ] pass interface to keenetic (currently hardcoded)
- [ ] support specifying interfaces by name
- [ ] support getting available interfaces from keenetic api
- [ ] show currently applied rules for each service

---

## Requirements and tech stack

- Node.js (v22) and pnpm (latest). Use .tool-versions file.
- ESM Support
- TypeScript with tsx: For type safety and maintainability
- sqlite for data storage

---

## Notes

- Ensure all sensitive data (e.g., credentials) are handled securely.
