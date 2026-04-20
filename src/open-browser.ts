import { isCancel, select } from "@clack/prompts";
import { gracefulExit } from "exit-hook";
import open from "open";

/**
 * Hostname segment for `http://…` when opening in a browser. Maps all-interfaces binds to loopback.
 */
export function hostnameForBrowserUrl(bind: string): string {
  const t = bind.trim();
  if (t === "" || t === "0.0.0.0") return "127.0.0.1";
  if (t === "::") return "[::1]";
  if (t.includes(":") && !t.startsWith("[")) {
    return `[${t}]`;
  }
  return t;
}

export function forwardHttpUrls(bind: string, publishedPorts: number[]): string[] {
  const host = hostnameForBrowserUrl(bind);
  return publishedPorts.map((p) => `http://${host}:${p}`);
}

export async function openForwardedUrls(bind: string, publishedPorts: number[]): Promise<void> {
  const urls = forwardHttpUrls(bind, publishedPorts);
  for (const url of urls) {
    await open(url, { wait: false });
  }
}

export async function openForwardedUrlsSafe(bind: string, publishedPorts: number[]): Promise<void> {
  try {
    await openForwardedUrls(bind, publishedPorts);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Could not open browser: ${msg}`);
  }
}

async function openUrlSafe(url: string): Promise<void> {
  try {
    await open(url, { wait: false });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Could not open browser: ${msg}`);
  }
}

export interface BrowserPickEntry {
  /** `http://…` URL passed to the default browser */
  url: string;
  /** Line shown in the menu */
  label: string;
}

/**
 * Repeatedly prompts to pick a forward; opens the chosen URL on Enter. Same options every time.
 * Stops when `signal` aborts (e.g. all sidecars exited). Esc or **Exit** ends the process via {@link gracefulExit}.
 */
const ALL_SENTINEL = "__browser_all__";
const EXIT_SENTINEL = "__browser_exit__";

export async function runBrowserPickLoop(params: {
  entries: BrowserPickEntry[];
  signal: AbortSignal;
}): Promise<void> {
  const { entries, signal } = params;
  if (entries.length === 0) return;

  const allUrls = entries.map((e) => e.url);
  const options = [
    {
      value: ALL_SENTINEL,
      label: "ALL — open every forward",
      hint: `${allUrls.length} tab(s)`,
    },
    ...entries.map((e) => ({
      value: e.url,
      label: e.label,
      hint: e.url,
    })),
    {
      value: EXIT_SENTINEL,
      label: "Exit — stop forwarding and quit",
      hint: "Same as Ctrl+C",
    },
  ];

  while (!signal.aborted) {
    let choice: string | symbol;
    try {
      choice = await select<string>({
        message:
          "Open in browser — ALL, one forward, or Exit. Esc quits (stops sidecars).",
        options,
        signal,
      });
    } catch (e: unknown) {
      if (signal.aborted) break;
      throw e;
    }

    if (signal.aborted) break;
    if (isCancel(choice)) {
      gracefulExit();
      return;
    }

    if (choice === EXIT_SENTINEL) {
      gracefulExit();
      return;
    }
    if (choice === ALL_SENTINEL) {
      for (const url of allUrls) {
        await openUrlSafe(url);
      }
      continue;
    }

    await openUrlSafe(choice);
  }
}
