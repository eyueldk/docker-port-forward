#!/usr/bin/env node

import { array, command, flag, multioption, option, run, string } from "cmd-ts";
import { asyncExitHook, gracefulExit } from "exit-hook";
import Docker from "dockerode";
import manifest from "../package.json" with { type: "json" };
import { promptForwardTargets } from "./interactive";
import { resolveForwardTarget } from "./network";
import { ensureSocatImage, startSocatSidecar, stopSidecar } from "./socat";
import {
  forwardHttpUrls,
  openForwardedUrlsSafe,
  runBrowserPickLoop,
  type BrowserPickEntry,
} from "./open-browser";
import {
  displayContainerRef,
  resolveTargetsFromCliArgs,
  type ResolvedForwardTarget,
} from "./targets";

const app = command({
  name: "docker-port-forward",
  version: manifest.version,
  description:
    "Temporarily publish host port(s) to running container(s) using socat sidecar container(s)",
  args: {
    target: multioption({
      long: "target",
      short: "t",
      type: array(string),
      description:
        "Target: container, container:port, or container:port:hostPort (repeatable). Omitted host port means Docker assigns an ephemeral port unless the third segment sets it.",
      defaultValue: () => [],
    }),
    interactive: flag({
      long: "interactive",
      short: "i",
      description: "Prompt to select container:port targets",
    }),
    openBrowser: flag({
      long: "open",
      description:
        "Open the default browser to each forwarded URL (http://…) after startup",
    }),
    host: option({
      long: "host",
      short: "H",
      type: string,
      description:
        "Host IP for published port (default loopback; use 0.0.0.0 for all interfaces)",
      defaultValue: () => "127.0.0.1",
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

    let resolved: ResolvedForwardTarget[];
    if (args.interactive) {
      resolved = await promptForwardTargets(docker);
    } else {
      resolved = await resolveTargetsFromCliArgs(docker, args.target);
    }

    const started: Awaited<ReturnType<typeof startSocatSidecar>>[] = [];
    try {
      for (const t of resolved) {
        const forward = await resolveForwardTarget(docker, t.containerRef);
        started.push(
          await startSocatSidecar({
            docker,
            networkName: forward.networkName,
            targetIp: forward.containerIp,
            targetPort: t.containerPort,
            hostPort: t.hostPort,
            hostBind: args.host,
          }),
        );
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await Promise.all(started.map((s) => stopSidecar(s.container)));
      throw new Error(`Failed to start socat sidecar: ${msg}`);
    }

    for (let i = 0; i < started.length; i++) {
      const { container: sidecar, publishedHostPort } = started[i];
      const t = resolved[i];
      const shortId = sidecar.id.slice(0, 12);
      const targetRef = displayContainerRef(t);
      console.log(
        `Forwarding ${args.host}:${publishedHostPort} -> ${targetRef}:${t.containerPort} [socat ${shortId}]`,
      );
    }

    const publishedPorts = started.map((s) => s.publishedHostPort);

    if (args.openBrowser) {
      await openForwardedUrlsSafe(args.host, publishedPorts);
    }

    const urls = forwardHttpUrls(args.host, publishedPorts);
    const browserEntries: BrowserPickEntry[] = urls.map((url, i) => ({
      url,
      label: `${displayContainerRef(resolved[i])}:${resolved[i].containerPort}  ${url}`,
    }));

    console.log("Press Ctrl+C to stop.");
    if (args.interactive && process.stdin.isTTY) {
      console.log(
        "Use the menu below to open forwards; Esc or Exit stops sidecars and quits (same as Ctrl+C).",
      );
    }

    const sidecars = started.map((s) => s.container);
    const pickAbort = new AbortController();
    const waitPromise = Promise.all(sidecars.map((c) => c.wait()));
    waitPromise.finally(() => pickAbort.abort());
    const unsubscribeExitHook = asyncExitHook(
      async () => {
        await Promise.all(sidecars.map((c) => stopSidecar(c)));
        console.log("Sidecars stopped.");
      },
      { wait: 15_000 },
    );

    let onSigbreak: (() => void) | undefined;
    if (process.platform === "win32") {
      onSigbreak = () => gracefulExit();
      process.once("SIGBREAK", onSigbreak);
    }

    try {
      await Promise.all([
        waitPromise,
        args.interactive && process.stdin.isTTY
          ? runBrowserPickLoop({ entries: browserEntries, signal: pickAbort.signal })
          : Promise.resolve(),
      ]);
      console.log("Sidecars exited.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Warning: failed while waiting on sidecar(s): ${message}`);
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
