import { randomBytes } from "node:crypto";
import { spinner } from "@clack/prompts";
import type Dockerode from "dockerode";

const SOCAT_IMAGE = "alpine/socat";
/** Fixed TCP port socat listens on inside the sidecar (host mapping is published separately). */
const SOCAT_LISTEN_PORT = 43789;

function isDockerNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "statusCode" in err &&
    (err as { statusCode: number }).statusCode === 404
  );
}

/**
 * Verifies the Docker daemon is reachable and that {@link SOCAT_IMAGE} exists locally,
 * pulling it from the registry when missing.
 */
export async function ensureSocatImage(
  docker: InstanceType<typeof Dockerode>,
): Promise<void> {
  await docker.ping();

  const image = docker.getImage(SOCAT_IMAGE);
  try {
    await image.inspect();
    return;
  } catch (e: unknown) {
    if (!isDockerNotFound(e)) throw e;
  }

  const pullSpinner = spinner();
  pullSpinner.start(`Pulling ${SOCAT_IMAGE}...`);
  try {
    const stream = await docker.pull(SOCAT_IMAGE);
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(stream, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    pullSpinner.stop(`Pulled ${SOCAT_IMAGE}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    pullSpinner.error(`Failed pulling ${SOCAT_IMAGE}: ${message}`);
    throw err;
  }
}

export interface StartSocatSidecarParams {
  docker: InstanceType<typeof Dockerode>;
  networkName: string;
  targetIp: string;
  targetPort: number;
  /** When set, publish this host port; when omitted, Docker assigns an ephemeral host port (`HostPort: "0"`). */
  hostPort?: number;
  hostBind: string;
}

export interface StartedSocatSidecar {
  container: Dockerode.Container;
  /** Host port clients connect to (from `--host-port` or Docker after `HostPort: "0"`). */
  publishedHostPort: number;
}

function sidecarName(): string {
  return `docker-port-forward-socat-${randomBytes(6).toString("hex")}`;
}

export async function startSocatSidecar(
  params: StartSocatSidecarParams,
): Promise<StartedSocatSidecar> {
  const { docker, networkName, targetIp, targetPort, hostPort, hostBind } = params;

  const name = sidecarName();
  const listenSpec = `TCP-LISTEN:${SOCAT_LISTEN_PORT},fork,reuseaddr`;
  const forwardSpec = `TCP:${targetIp}:${targetPort}`;

  const exposed: Record<string, object> = {
    [`${SOCAT_LISTEN_PORT}/tcp`]: {},
  };

  const hostIpForDocker =
    hostBind === "0.0.0.0" || hostBind === "::" ? "" : hostBind;

  const hostPortBinding =
    hostPort !== undefined ? String(hostPort) : "0";

  const portBindings: Record<string, { HostIp?: string; HostPort: string }[]> =
    {
      [`${SOCAT_LISTEN_PORT}/tcp`]: [
        { HostIp: hostIpForDocker, HostPort: hostPortBinding },
      ],
    };

  const container = await docker.createContainer({
    name,
    Image: SOCAT_IMAGE,
    Cmd: [listenSpec, forwardSpec],
    Labels: { "docker-port-forward.sidecar": "true" },
    HostConfig: {
      PortBindings: portBindings,
      AutoRemove: true,
    },
    ExposedPorts: exposed,
    NetworkingConfig: {
      EndpointsConfig: {
        [networkName]: {},
      },
    },
  });

  await container.start();

  if (hostPort !== undefined) {
    return { container, publishedHostPort: hostPort };
  }

  const inspect = await container.inspect();
  const published = inspect.NetworkSettings?.Ports?.[`${SOCAT_LISTEN_PORT}/tcp`]?.[0]
    ?.HostPort;
  const parsed = published !== undefined ? Number.parseInt(published, 10) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      "Docker did not report a host port for the socat sidecar (dynamic port mapping).",
    );
  }

  return { container, publishedHostPort: parsed };
}

export async function stopSidecar(
  container: Dockerode.Container | undefined,
): Promise<void> {
  if (!container) return;
  try {
    await container.stop({ t: 10 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/is not running|NotFound/i.test(msg)) {
      console.error(`Warning: could not stop sidecar cleanly: ${msg}`);
    }
  }
}
