import type Dockerode from "dockerode";

/** Parsed from a single `-t` / `--target` string (before implicit port resolution). */
interface ParsedTargetToken {
  containerRef: string;
  containerPort?: number;
  hostPortInTarget?: number;
}

export interface ResolvedForwardTarget {
  containerRef: string;
  containerPort: number;
  /** Published host port for the sidecar; omit for ephemeral. */
  hostPort?: number;
  /** Human-readable name when known (e.g. from interactive selection). */
  containerLabel?: string;
}

function parsePort(s: string, label: string): number {
  const n = Number.parseInt(s, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid ${label}: expected an integer from 1 to 65535.`);
  }
  return n;
}

/**
 * Parses `container`, `container:port`, or `container:port:hostPort`.
 * Container refs must not contain `:`.
 */
function parseTargetToken(raw: string): ParsedTargetToken {
  const s = raw.trim();
  if (!s) {
    throw new Error("Empty --target value.");
  }
  const parts = s.split(":");
  if (parts.length > 3) {
    throw new Error(
      `Invalid --target "${raw}": use container, container:port, or container:port:hostPort (container ref must not contain ':').`,
    );
  }
  if (!parts[0]) {
    throw new Error(`Invalid --target "${raw}": container ref is empty.`);
  }
  if (parts.length === 1) {
    return { containerRef: parts[0] };
  }
  if (parts.length === 2) {
    return { containerRef: parts[0], containerPort: parsePort(parts[1], "container port") };
  }
  return {
    containerRef: parts[0],
    containerPort: parsePort(parts[1], "container port"),
    hostPortInTarget: parsePort(parts[2], "host port"),
  };
}

/**
 * Unique TCP ports inferred from image/config/network settings (inspect).
 */
function tcpPortsFromInspect(inspect: Dockerode.ContainerInspectInfo): number[] {
  const set = new Set<number>();
  const exposed = inspect.Config?.ExposedPorts;
  if (exposed) {
    for (const key of Object.keys(exposed)) {
      const m = /^(\d+)\/tcp$/i.exec(key);
      if (m) set.add(Number.parseInt(m[1], 10));
    }
  }
  const netPorts = inspect.NetworkSettings?.Ports;
  if (netPorts) {
    for (const key of Object.keys(netPorts)) {
      const m = /^(\d+)\/tcp$/i.exec(key);
      if (m) set.add(Number.parseInt(m[1], 10));
    }
  }
  return [...set].sort((a, b) => a - b);
}

export async function resolveImplicitContainerPort(
  docker: InstanceType<typeof Dockerode>,
  containerRef: string,
): Promise<number> {
  let inspect: Dockerode.ContainerInspectInfo;
  try {
    inspect = await docker.getContainer(containerRef).inspect();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Container "${containerRef}" not found or inaccessible: ${msg}`);
  }
  const ports = tcpPortsFromInspect(inspect);
  if (ports.length === 0) {
    throw new Error(
      `Container "${containerRef}" has no exposed TCP port to infer; specify container:port in --target.`,
    );
  }
  if (ports.length > 1) {
    throw new Error(
      `Container "${containerRef}" exposes multiple TCP ports (${ports.join(", ")}); specify container:port in --target.`,
    );
  }
  return ports[0];
}

function targetDedupeKey(t: ResolvedForwardTarget): string {
  return `${t.containerRef}:${t.containerPort}:${t.hostPort ?? "_ephemeral_"}`;
}

/** Prefer Docker container name when `containerLabel` is set; otherwise shorten id-like refs. */
export function displayContainerRef(t: ResolvedForwardTarget): string {
  return t.containerLabel ?? conciseHexIdRef(t.containerRef);
}

function conciseHexIdRef(ref: string): string {
  return /^[a-f0-9]{25,}$/i.test(ref) ? ref.slice(0, 12) : ref;
}

export function dedupeTargets(targets: ResolvedForwardTarget[]): ResolvedForwardTarget[] {
  const seen = new Set<string>();
  const out: ResolvedForwardTarget[] = [];
  for (const t of targets) {
    const k = targetDedupeKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export async function resolveTargetsFromCliArgs(
  docker: InstanceType<typeof Dockerode>,
  targetStrings: string[],
): Promise<ResolvedForwardTarget[]> {
  if (targetStrings.length === 0) {
    throw new Error("Missing --target (or use --interactive).");
  }

  const result: ResolvedForwardTarget[] = [];
  for (const raw of targetStrings) {
    const p = parseTargetToken(raw);
    const containerPort =
      p.containerPort === undefined
        ? await resolveImplicitContainerPort(docker, p.containerRef)
        : p.containerPort;

    result.push({
      containerRef: p.containerRef,
      containerPort,
      hostPort: p.hostPortInTarget,
    });
  }

  return dedupeTargets(result);
}
