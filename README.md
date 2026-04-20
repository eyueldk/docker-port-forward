# docker-port-forward

Small CLI that exposes **temporary TCP port(s) on the host** to **running Docker container(s)** by starting one [`alpine/socat`](https://hub.docker.com/r/alpine/socat) sidecar per target on the same Docker network.

**Requirements:** Docker Engine API reachable locally, **Node.js ≥ 20**.

## Install

```bash
npm install -g @eyueldk/docker-port-forward
```

## Usage

Each `--target` (`-t`) selects a forward. The value has one of three forms:

| Form | Meaning |
|------|--------|
| `container` | Container name or ID. The container must expose **exactly one** TCP port (otherwise specify `container:port`). |
| `container:port` | TCP port inside the container. The published host port is **ephemeral** unless you add the third segment. |
| `container:port:hostPort` | Container port and the **host** port to publish for that sidecar. |

Examples:

```bash
docker-port-forward -t my-app:8080
docker-port-forward -t web:80:3000
docker-port-forward -t redis -t nginx:80
```

- **`Ctrl+C`** stops all sidecars and exits.
- If every sidecar exits on its own, the CLI exits after that.

### Open in browser

- **`--open`**: after forwards are up, open the default browser to each forwarded URL (`http://…`). If you publish on `0.0.0.0` / `::`, the browser opens `http://127.0.0.1:…` / `http://[::1]:…`.
- **Interactive mode** (stdin must be a TTY): after forwards start, a **menu** includes **ALL** (open every forward), each forward, and **Exit** to stop sidecars and quit (same as **Ctrl+C**). **Esc** on the menu does the same. Otherwise forwards run until sidecars exit on their own.

### Interactive mode

Select one or more **container:port** pairs from running containers (grouped by Compose project when applicable). Only ports Docker reports as exposed are listed; for anything else, use `-t`.

```bash
docker-port-forward --interactive
```

### Common options

| Option | Description |
|--------|-------------|
| `-t, --target` | Target (`container`, `container:port`, or `container:port:hostPort`). Repeat for multiple forwards. |
| `-i, --interactive` | Prompt for targets |
| `--open` | Open default browser to each `http://` forwarded URL after startup |
| `-H, --host` | Host IP for the publish (default `127.0.0.1`; use `0.0.0.0` for all interfaces) |

```bash
docker-port-forward --help
```

## Development

```bash
pnpm install
pnpm run build
pnpm run dev -- --help
```

## License

MIT
