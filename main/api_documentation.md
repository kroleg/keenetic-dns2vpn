# Keenetic Router API Documentation (from ruby-master analysis)

This document outlines the API endpoints, request/response formats, and business logic for interacting with Keenetic routers, as reverse-engineered from the `ruby-master` project.

## I. Authentication

Authentication is handled by the `KeeneticMaster::Client` class and uses a challenge-response mechanism.

**Credentials:**
- `KEENETIC_LOGIN`: Username for the router. (Source: ENV variable)
- `KEENETIC_PASSWORD`: Password for the router. (Source: ENV variable)
- `KEENETIC_HOST`: IP address or hostname of the router. (Source: ENV variable)

**Session Management:**
- Cookies are used for session persistence.
- A cookie file is stored at `config/cookie` (relative to the ruby-master project's execution path).

**Authentication Flow:**

1.  **Initial Request (Check Session):**
    *   **Endpoint:** `GET /auth`
    *   **Purpose:** Check if a valid session already exists (via cookie).
    *   **Responses:**
        *   `200 OK`: Session is active. No further authentication needed for this request cycle.
        *   `401 Unauthorized`: Session is not active or invalid. Proceed to login.
        *   Other codes: Error.

2.  **Login (if 401 from initial request):**
    *   The `401 Unauthorized` response from `GET /auth` must include:
        *   `X-NDM-Realm` (header): The authentication realm.
        *   `X-NDM-Challenge` (header): A challenge string.
    *   **Password Hashing:**
        1.  `md5_hash = MD5(KEENETIC_LOGIN + ":" + X-NDM-Realm + ":" + KEENETIC_PASSWORD)`
        2.  `final_password_hash = SHA256(X-NDM-Challenge + md5_hash)`
    *   **Endpoint:** `POST /auth`
    *   **Request Body (JSON):**
        ```json
        {
          "login": "YOUR_KEENETIC_LOGIN",
          "password": "CALCULATED_FINAL_PASSWORD_HASH"
        }
        ```
    *   **Responses:**
        *   `200 OK`: Login successful. A session cookie is set.
        *   Other codes: Login failed.

## II. RCI (Remote Command Interface)

Most router configurations and actions are performed via the RCI endpoint.

**Base Endpoint:** `POST /rci/`

**General Request Structure:**
- All RCI requests are HTTP POST.
- The request body is typically a JSON array of command objects.
- Many operations include a "webhelp event push" for UI notifications and a "system configuration save" command.

**Common Headers for RCI POST requests:**
- `Content-Type: application/json`
- `Accept: application/json`

**General RCI Command Structure within the JSON array:**
```json
[
  // Optional: UI event notification
  {
    "webhelp": {
      "event": {
        "push": {
          // Data is often stringified JSON
          "data": "{\"type\":\"configuration_change\",\"value\":{\"url\":\"/someUiPath\"}}"
        }
      }
    }
  },
  // Actual command(s)
  {
    "command_namespace": { // e.g., "ip", "system", "show"
      "command_module": { // e.g., "route", "hotspot", "policy"
        // ...command specific parameters or sub-objects...
        // For "show" commands, this might be empty: {}
      }
    }
  },
  // ... more commands ...
  // Optional: Save configuration
  {
    "system": {
      "configuration": {
        "save": {}
      }
    }
  }
]
```

**General RCI Response Structure:**
- `200 OK` on successful HTTP transaction.
- The response body is a JSON array, mirroring the commands sent, often with status information.
- For commands that modify configuration, the relevant part of the response might contain a `status` object, e.g.:
  ```json
  // Example for a route operation status
  {
    "ip": {
      "route": {
        "status": [ // Array, usually one element for single operations
          {
            "status": "success", // or "error"
            "message": "Description of outcome"
          }
        ]
      }
    }
  }
  ```

---

### A. Show Commands (Data Retrieval)

These commands are used to fetch information from the router. They can be sent via `POST /rci/` (as part of a JSON array body with a `show` command) or sometimes via specific `GET` endpoints.

1.  **Get System Information:**
    *   **Endpoint:** `GET /rci/show/system`
    *   **RCI POST equivalent:** `{"show": {"system": {}}}`
    *   **Response:** JSON object with various system details.

2.  **Get Interface Details:**
    *   **Endpoint:** `GET /rci/show/interface`
    *   **RCI POST equivalent:** `{"show": {"interface": {}}}`
    *   **Response:** JSON object/array detailing all network interfaces (e.g., `id`, `description`, `type`).
        *Example snippet:*
        ```json
        {
          "Show0": { "id": "Show0", "description": "My Interface", ... },
          "Wg0": { "id": "Wg0", "description": "[WG] VPN to Home", ... }
        }
        ```

3.  **Get Configured IP Policies:**
    *   **RCI POST Command:** `{"show": {"sc": {"ip": {"policy": {}}}}}`
        *   `sc` likely means "startup-config" or "system-config".
    *   **Response:** JSON detailing configured IP classification policies.

4.  **Get Configured Hotspot Hosts/Clients:**
    *   **RCI POST Command:** `{"show": {"sc": {"ip": {"hotspot": {"host": {}}}}}}`
    *   **Response:** JSON detailing known clients and their configurations (MAC, assigned policy, etc.).

5.  **Get Current Hotspot State:**
    *   **RCI POST Command:** `{"show": {"ip": {"hotspot": {}}}}`
    *   **Response:** JSON with current status of connected hotspot clients.

6.  **Get Configured Static IP Routes:**
    *   **RCI POST Command:** `{"show": {"sc": {"ip": {"route": {}}}}}`
    *   **Response:** JSON array of configured static routes. Each route object contains keys like `network`, `mask`, `interface`, `comment`, `host`, `gateway`, `metric`, `auto`.

---

### B. Configuration Commands (Data Modification)

These commands modify the router's configuration.

1.  **Add Static IP Routes:**
    *   **Purpose:** Adds one or more static IP routes.
    *   **RCI Commands (within the array sent to `POST /rci/`):**
        *   Each route is an object:
            ```json
            {
              "ip": {
                "route": {
                  // Option 1: Network and Mask
                  "network": "TARGET_NETWORK_IP",   // e.g., "192.168.100.0"
                  "mask": "SUBNET_MASK",            // e.g., "255.255.255.0"
                  // Option 2: Single Host (implicitly /32)
                  // "host": "TARGET_HOST_IP",     // e.g., "10.0.0.5"

                  "interface": "INTERFACE_ID",      // e.g., "Wg0", "Show0"
                  "comment": "Optional route comment",
                  "gateway": "", // Often empty for interface-bound routes
                  "auto": true,  // Keenetic specific flag
                  "reject": false // For reject routes
                  // "metric": X // Optional metric
                }
              }
            }
            ```
    *   **Note:** Multiple such `{"ip": {"route": ...}}` objects can be in the array. Typically bundled with `webhelp event push` for `/staticRoutes` and `system configuration save`.

2.  **Delete Static IP Routes:**
    *   **Purpose:** Deletes one or more static IP routes.
    *   **RCI Commands (within the array sent to `POST /rci/`):**
        *   Each route to delete is identified by its properties, with `no: true`:
            ```json
            {
              "ip": {
                "route": {
                  "no": true,
                  // Option 1: Network and Mask
                  "network": "NETWORK_IP_TO_DELETE",
                  "mask": "SUBNET_MASK_TO_DELETE",
                  // Option 2: Single Host
                  // "host": "HOST_IP_TO_DELETE",

                  "comment": "COMMENT_OF_ROUTE_TO_DELETE" // Comment seems to be part of identity for deletion
                  // "interface": "INTERFACE_ID" // Interface might also be needed for unique identification if routes can overlap
                }
              }
            }
            ```
    *   **Note:** Multiple such deletion commands can be in the array. Typically bundled with `webhelp event push` for `/staticRoutes` and `system configuration save`.

---

## III. Business Logic & Flows

1.  **Domain-Based VPN Routing (`UpdateDomainRoutes` class):**
    *   **Configuration:** Reads a YAML file (path from `ENV['DOMAINS_FILE']`) containing groups of domains/IPs/CIDRs.
        *   Each group can have settings for `mask` and `interfaces` (comma-separated).
        *Example YAML structure:*
        ```yaml
        youtube:
          settings:
            mask: 24 # CIDR prefix for resolved IPs
            interfaces: Wireguard0,[WG] Descriptive Name # Router interface ID or description
          domains:
            - "youtube.com"
            - "googlevideo.com"
            - "172.217.0.0/16" # CIDR block
        github: # Special group, fetches IPs from GitHub meta API
          # ...
        ```
    *   **Process:**
        1.  Retrieves existing auto-added routes for the group (identified by comment `[auto:{group_name}] ...`).
        2.  For each domain/IP entry in the YAML for the target group:
            *   If domain: Resolves to IP(s) using DNS servers (`ENV['DNS_SERVERS']` or defaults `1.1.1.1, 8.8.8.8`).
            *   Applies the specified `mask` to resolved IPs or uses the mask from CIDR entries.
            *   Maps descriptive interface names from YAML to actual interface IDs using `GET /rci/show/interface`.
        3.  Calculates routes to add (those in YAML/resolved IPs but not on router) and routes to delete (those on router with matching comment but not in current YAML/resolved IPs).
        4.  Uses **Add Static IP Routes** and **Delete Static IP Routes** RCI commands.
    *   **Special Handling:** For the `github` group, it fetches IP ranges from `https://api.github.com/meta`.
    *   **Route Commenting:** Added routes are commented as `[auto:{group_name}] {original_domain_or_type}`.

2.  **Interface ID Correction (`correct_interface_id` logic):**
    *   Input: An interface name string (e.g., `Wireguard0` or `[WG] My VPN`).
    *   Process:
        1.  Fetches all interfaces from `GET /rci/show/interface`.
        2.  If input string is a direct ID match, returns it.
        3.  Else, searches for an interface whose `description` field matches the input string.
        4.  Returns the `id` of the matched interface.

3.  **Constants:**
    *   `Constants::MASKS`: A hash mapping CIDR prefix lengths (e.g., "24") to full subnet mask strings (e.g., "255.255.255.0").

## IV. Key Environment Variables

-   `KEENETIC_LOGIN`: Router username.
-   `KEENETIC_PASSWORD`: Router password.
-   `KEENETIC_HOST`: Router IP/hostname.
-   `DOMAINS_FILE`: Path to the YAML file for domain-based routing.
-   `DOMAINS_MASK`: Default subnet mask (CIDR prefix, e.g., "32") for resolved domain IPs if not specified per-group in YAML.
-   `KEENETIC_VPN_INTERFACE` / `KEENETIC_VPN_INTERFACES`: Default VPN interface(s) if not specified per-group in YAML.
-   `DNS_SERVERS`: Comma-separated list of DNS servers for domain resolution.
-   `DELETE_ROUTES`: (Optional, e.g., set to `"false"`) If `"false"`, prevents the `UpdateDomainRoutes` logic from deleting existing routes.
