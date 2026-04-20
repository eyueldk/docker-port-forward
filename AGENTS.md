## Learned User Preferences
- Prefer concrete, explicit library types over generic `ReturnType` wrappers.
- Prefer using Dockerode-provided types directly instead of maintaining separate local types files.
- Prefer simpler, clearer implementations that combine tightly related steps into well-named functions.

## Learned Workspace Facts
- This workspace is a TypeScript ESM CLI project; the npm package is `@eyueldk/docker-port-forward` and the `bin` name is `docker-port-forward`.
- Published tarball includes `dist/`, `README.md`, and `LICENSE` (`package.json` `files` field).
- `prepublishOnly` runs `pnpm run typecheck && pnpm run build` (use `pnpm install`; Corepack can honor `packageManager` in `package.json`).
- The CLI uses `cmd-ts` and `dockerode`.
- Targets use repeatable `-t` / `--target`: `container` (requires exactly one inferred exposed TCP port), `container:port`, or `container:port:hostPort` to pin the published host port; there is no separate `--host-port` flag. `--host` (default `127.0.0.1`) sets HostIp for published ports.
- There is no `--network` flag; the sidecar uses the first container network attachment that has a usable IPv4.
- Interactive mode is a grouped multiselect of listed `container:port` pairs only (no follow-up free-text targets); use `-t` for ports not shown. With a TTY, after forwards start a repeating `@clack/prompts` `select` lists ALL / each forward / Exit; Esc or Exit calls `gracefulExit()` like Ctrl+C (`--open` still does a one-shot open all).
- `dev` runs `tsx src/cli.ts` (`pnpm run dev`) for executing the CLI from source without building.
- Port forwarding uses one temporary `socat` sidecar per target on a Docker network.
- The build uses `tsdown` and outputs `dist/cli.js`.
