## Learned User Preferences
- Prefer concrete, explicit library types over generic `ReturnType` wrappers.
- Prefer using Dockerode-provided types directly instead of maintaining separate local types files.
- Prefer simpler, clearer implementations that combine tightly related steps into well-named functions.

## Learned Workspace Facts
- This workspace is a TypeScript ESM CLI project named `docker-port-forward`.
- The CLI uses `cmd-ts` and `dockerode`.
- Port forwarding is implemented with a temporary `socat` sidecar container on a Docker network.
- The build uses `tsdown` and outputs `dist/cli.js`.
