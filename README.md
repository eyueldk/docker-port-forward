# docker-port-forward

Small CLI that exposes a **temporary TCP port on the host** to a **running Docker container** by starting an [`alpine/socat`](https://hub.docker.com/r/alpine/socat) sidecar on the same Docker network.

**Requirements:** Docker Engine API reachable locally, **Node.js ≥ 20**.

## Install

```bash
npm install -g @eyueldk/docker-port-forward
```

## Usage

```bash
docker-port-forward --container my-app --container-port 8080
```

- **`Ctrl+C`** stops the sidecar and exits.
- If the sidecar container exits on its own, the CLI exits after that.

### Interactive mode

Pick a running container and port from prompts:

```bash
docker-port-forward --interactive
```

### Common options

| Option | Description |
|--------|-------------|
| `-c, --container` | Target container name or ID |
| `-p, --container-port` | TCP port inside the target container |
| `-i, --interactive` | Prompt for container and port |
| `--host-port` | Host port (omit for an ephemeral port) |
| `--bind` | Host IP for the publish (default `127.0.0.1`; use `0.0.0.0` for all interfaces) |
| `--network` | Docker network name when the target has several networks |

```bash
docker-port-forward --help
```

## Development

```bash
npm install
npm run build
node dist/cli.js --help
```

## License

MIT
