#!/usr/bin/env node

import { command, flag, number, option, optional, run, string } from "cmd-ts";
import { asyncExitHook, gracefulExit } from "exit-hook";
import Docker from "dockerode";
import manifest from "../package.json" with { type: "json" };
import { promptContainerAndPort } from "./interactive";
import { resolveForwardTarget } from "./network";
import { ensureSocatImage, startSocatSidecar, stopSidecar } from "./socat";

interface EffectiveArgs {
  container: string;
  containerPort: number;
  hostPort: number | undefined;
  bind: string;
  network: string | undefined;
}

function conciseContainerRef(ref: string): string {
  return /^[a-f0-9]{25,}$/i.test(ref) ? ref.slice(0, 12) : ref;
}

const app = command({
  name: "docker-port-forward",
  version: manifest.version,
  description:
    "Temporarily publish a host port to a running container using a socat sidecar container",
  args: {
    container: option({
      long: "container",
      short: "c",
      type: optional(string),
      description: "Target container name or ID",
    }),
    containerPort: option({
      long: "container-port",
      short: "p",
      type: optional(number),
      description: "TCP port inside the target container",
    }),
    interactive: flag({
      long: "interactive",
      short: "i",
      description: "Prompt to select container and container port",
    }),
    hostPort: option({
      long: "host-port",
      type: optional(number),
      description:
        "Host port to publish (if omitted, Docker assigns an ephemeral host port)",
    }),
    bind: option({
      long: "bind",
      type: string,
      description: "Host IP for the published port (use 0.0.0.0 for all interfaces)",
      defaultValue: () => "127.0.0.1",
    }),
    network: option({
      long: "network",
      type: optional(string),
      description:
        "Docker network to use (defaults to the first attachment with an IPv4; use when you need a specific network)",
    }),
  },
  handler: async (args) => {
    const docker = new Docker();

    try {
      await ensureSocatImage(docker);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Docker is not ready or socat image could not be prepared: ${msg}`);
    }

    const interactiveSelection = args.interactive
      ? await promptContainerAndPort(docker, args.containerPort ?? 80)
      : undefined;

    const effectiveArgs: EffectiveArgs = {
      container: interactiveSelection?.container ?? args.container ?? "",
      containerPort: interactiveSelection?.containerPort ?? args.containerPort ?? Number.NaN,
      hostPort: args.hostPort,
      bind: args.bind,
      network: args.network,
    };

    if (!effectiveArgs.container) {
      throw new Error("Missing --container (or use --interactive).");
    }
    if (!Number.isInteger(effectiveArgs.containerPort) || effectiveArgs.containerPort <= 0) {
      throw new Error("Missing or invalid --container-port (or use --interactive).");
    }

    const forward = await resolveForwardTarget(
      docker,
      effectiveArgs.container,
      effectiveArgs.network,
    );

    let startedSidecar: Awaited<ReturnType<typeof startSocatSidecar>>;
    try {
      startedSidecar = await startSocatSidecar({
        docker,
        networkName: forward.networkName,
        targetIp: forward.containerIp,
        targetPort: effectiveArgs.containerPort,
        hostPort: effectiveArgs.hostPort,
        hostBind: effectiveArgs.bind,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to start socat sidecar: ${msg}`);
    }

    const { container: sidecar, publishedHostPort } = startedSidecar;
    const shortId = sidecar.id.slice(0, 12);
    const targetRef = conciseContainerRef(effectiveArgs.container);
    console.log(
      `Forwarding ${effectiveArgs.bind}:${publishedHostPort} -> ${targetRef}:${effectiveArgs.containerPort} [socat ${shortId}]`,
    );
    console.log("Press Ctrl+C to stop.");

    const unsubscribeExitHook = asyncExitHook(
      async () => {
        await stopSidecar(sidecar);
        console.log("Sidecar stopped.");
      },
      { wait: 15_000 },
    );

    let onSigbreak: (() => void) | undefined;
    if (process.platform === "win32") {
      onSigbreak = () => gracefulExit();
      process.once("SIGBREAK", onSigbreak);
    }

    try {
      await sidecar.wait();
      console.log("Sidecar exited.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Warning: failed while waiting on sidecar: ${message}`);
    } finally {
      unsubscribeExitHook();
      if (onSigbreak) {
        process.off("SIGBREAK", onSigbreak);
      }
    }
  },
});

run(app, process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
