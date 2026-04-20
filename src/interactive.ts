import { cancel, groupMultiselect, isCancel } from "@clack/prompts";
import type Docker from "dockerode";
import type Dockerode from "dockerode";
import { dedupeTargets, type ResolvedForwardTarget } from "./targets";

export type { ResolvedForwardTarget };

function containerName(container: Dockerode.ContainerInfo): string {
  return container.Names[0]?.replace(/^\//, "") ?? container.Id.slice(0, 12);
}

function exposedContainerPorts(container: Dockerode.ContainerInfo): number[] {
  const ports = new Set<number>();
  // WARNING: Ports is not typed correctly. Maybe null.
  if (!Array.isArray(container.Ports)) {
    return [];
  }
  for (const port of container.Ports) {
    if (port.PrivatePort > 0) ports.add(port.PrivatePort);
  }
  return [...ports].sort((a, b) => a - b);
}

function selectionToTarget(value: string): ResolvedForwardTarget {
  const m = /^(.+):(\d+)$/.exec(value.trim());
  if (!m) {
    throw new Error(`Invalid internal selection value "${value}".`);
  }
  return {
    containerRef: m[1],
    containerPort: Number.parseInt(m[2], 10),
    hostPort: undefined,
  };
}

export async function promptForwardTargets(
  docker: InstanceType<typeof Docker>,
): Promise<ResolvedForwardTarget[]> {
  const runningContainers = await docker.listContainers({ all: false });
  if (runningContainers.length === 0) {
    throw new Error("No running containers were found.");
  }

  const grouped = new Map<string, Dockerode.ContainerInfo[]>();
  for (const container of runningContainers) {
    const project = container.Labels["com.docker.compose.project"] ?? "Other Containers";
    const existing = grouped.get(project);
    if (existing) existing.push(container);
    else grouped.set(project, [container]);
  }

  const options: Record<string, { value: string; label: string; hint?: string }[]> = {};

  for (const [project, containers] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const projectOptions: { value: string; label: string; hint?: string }[] = [];
    for (const container of containers.sort((a, b) => containerName(a).localeCompare(containerName(b)))) {
      const exposed = exposedContainerPorts(container);
      const service = container.Labels["com.docker.compose.service"];
      const name = containerName(container);
      for (const port of exposed) {
        const value = `${container.Id}:${port}`;
        const label = service ? `${service} (${name})` : name;
        projectOptions.push({
          value,
          label: `  ${label} : ${port}`,
          hint: container.Image,
        });
      }
    }
    if (projectOptions.length > 0) {
      options[project] = projectOptions;
    }
  }

  if (Object.keys(options).length === 0) {
    throw new Error(
      "No exposed TCP ports were found on running containers; use non-interactive mode with -t instead.",
    );
  }

  const picked = await groupMultiselect<string>({
    message: "Select container:port targets (space to toggle)",
    options,
    required: true,
  });
  if (isCancel(picked)) {
    cancel("Operation cancelled.");
    process.exit(0);
  }

  const byId = new Map(runningContainers.map((c) => [c.Id, c]));

  return dedupeTargets(
    picked.map((value) => {
      const t = selectionToTarget(value);
      const info = byId.get(t.containerRef);
      const containerLabel = info ? containerName(info) : undefined;
      return containerLabel ? { ...t, containerLabel } : t;
    }),
  );
}
