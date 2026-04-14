import { cancel, isCancel, select, text } from "@clack/prompts";
import type Docker from "dockerode";
import type Dockerode from "dockerode";

export interface InteractiveSelection {
  container: string;
  containerPort: number;
}

function containerName(container: Dockerode.ContainerInfo): string {
  return container.Names[0]?.replace(/^\//, "") ?? container.Id.slice(0, 12);
}

function defaultContainerPort(container: Dockerode.ContainerInfo): number | undefined {
  return container.Ports.find((port) => port.PrivatePort > 0)?.PrivatePort;
}

function exposedContainerPorts(container: Dockerode.ContainerInfo): number[] {
  const ports = new Set<number>();
  for (const port of container.Ports) {
    if (port.PrivatePort > 0) ports.add(port.PrivatePort);
  }
  return [...ports].sort((a, b) => a - b);
}

export async function promptContainerAndPort(
  docker: InstanceType<typeof Docker>,
  fallbackPort: number,
): Promise<InteractiveSelection> {
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

  const choices: Array<{
    value: string;
    label: string;
    hint?: string;
    disabled?: boolean;
  }> = [];

  for (const [project, containers] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    choices.push({
      value: `__group__${project}`,
      label: project,
      disabled: true,
    });
    for (const container of containers.sort((a, b) => containerName(a).localeCompare(containerName(b)))) {
      const service = container.Labels["com.docker.compose.service"];
      const name = containerName(container);
      const label = service ? `  ${service} (${name})` : `  ${name}`;
      choices.push({ label, hint: container.Image, value: container.Id });
    }
  }

  const container = await select<string>({
    message: "Select a container",
    options: choices,
  });
  if (isCancel(container)) {
    cancel("Operation cancelled.");
    process.exit(0);
  }

  const selected = runningContainers.find((entry) => entry.Id === container);
  const suggestedPort = selected ? defaultContainerPort(selected) : undefined;
  const exposed = selected ? exposedContainerPorts(selected) : [];

  const manualPortValue = "__manual__";
  const portChoice = await select<string>({
    message: "Select container TCP port",
    options: [
      ...exposed.map((port) => ({
        value: String(port),
        label: String(port),
        hint: "Exposed port",
      })),
      {
        value: manualPortValue,
        label: "Enter manually",
        hint: `Default ${suggestedPort ?? fallbackPort}`,
      },
    ],
  });
  if (isCancel(portChoice)) {
    cancel("Operation cancelled.");
    process.exit(0);
  }

  let containerPort: number;
  if (portChoice === manualPortValue) {
    const typedPort = await text({
      message: "Container TCP port",
      placeholder: String(suggestedPort ?? fallbackPort),
      defaultValue: String(suggestedPort ?? fallbackPort),
      validate: (value) => {
        const n = Number.parseInt(value ?? "", 10);
        if (Number.isInteger(n) && n > 0) return;
        return "Enter a valid TCP port number.";
      },
    });
    if (isCancel(typedPort)) {
      cancel("Operation cancelled.");
      process.exit(0);
    }
    containerPort = Number.parseInt(typedPort, 10);
  } else {
    containerPort = Number.parseInt(portChoice, 10);
  }

  return { container, containerPort };
}
