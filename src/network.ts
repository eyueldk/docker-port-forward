import { isIPv4 } from "node:net";
import type Dockerode from "dockerode";

/** Where the sidecar should forward: Docker network + target container IPv4 on that network. */
export interface ResolvedForwardTarget {
  networkName: string;
  containerIp: string;
}

function pickFirstNetworkWithIpv4(
  entries: [string, { IPAddress?: string }][],
): ResolvedForwardTarget {
  for (const [networkName, ep] of entries) {
    const ip = ep.IPAddress?.trim() ?? "";
    if (ip && isIPv4(ip)) {
      return { networkName, containerIp: ip };
    }
  }
  throw new Error(
    "No network attachment has a usable IPv4 address for this container.",
  );
}

function requireIpv4(networkName: string, ep: { IPAddress?: string }): string {
  const ip = ep.IPAddress?.trim() ?? "";
  if (!ip || !isIPv4(ip)) {
    throw new Error(
      `No usable IPv4 address on network "${networkName}" for this container.`,
    );
  }
  return ip;
}

/**
 * Inspect the container, ensure it is running, and choose a Docker network + IPv4 for the
 * socat sidecar. With multiple networks, the first attachment that has a usable IPv4 is used;
 * pass `--network` to pick a specific one instead.
 */
export async function resolveForwardTarget(
  docker: InstanceType<typeof Dockerode>,
  containerRef: string,
  networkOverride: string | undefined,
): Promise<ResolvedForwardTarget> {
  let inspect: Dockerode.ContainerInspectInfo;
  try {
    inspect = await docker.getContainer(containerRef).inspect();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Container "${containerRef}" not found or inaccessible: ${msg}`);
  }

  if (!inspect.State?.Running) {
    throw new Error(`Container "${containerRef}" is not running.`);
  }

  const map = inspect.NetworkSettings?.Networks ?? {};
  const entries = Object.entries(map);

  if (entries.length === 0) {
    throw new Error("Container has no network attachments.");
  }

  const networkNames = entries.map(([name]) => name);

  if (networkOverride !== undefined) {
    const ep = map[networkOverride];
    if (!ep) {
      throw new Error(
        `Network "${networkOverride}" not found on container. Available: ${networkNames.join(", ")}`,
      );
    }
    return {
      networkName: networkOverride,
      containerIp: requireIpv4(networkOverride, ep),
    };
  }

  return pickFirstNetworkWithIpv4(entries);
}
