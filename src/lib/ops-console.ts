import { logOpsEventSoon, type OpsEventSeverity } from "@/lib/ops-events";

const INSTALLED = Symbol.for("aquarius.opsConsoleInstalled");

function stringifyArg(arg: unknown): string {
  if (arg instanceof Error) return arg.message;
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function inferEvent(args: unknown[]): string {
  const objectArg = args.find(
    (arg): arg is { event?: unknown } =>
      arg !== null && typeof arg === "object" && "event" in arg
  );
  if (typeof objectArg?.event === "string") return objectArg.event;

  const first = args.find((arg) => typeof arg === "string");
  if (!first) return "console_event";
  const match = first.match(/^\[([^\]]+)\]/);
  return match?.[1]?.replace(/[^a-zA-Z0-9_.:-]/g, "_") ?? "console_event";
}

function inferArea(args: unknown[]): string {
  const first = args.find((arg) => typeof arg === "string");
  if (!first) return "server";
  return first.match(/^\[([^\]]+)\]/)?.[1] ?? "server";
}

function metadataFromArgs(args: unknown[]): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const arg of args) {
    if (arg instanceof Error) {
      metadata.errorName = arg.name;
      metadata.errorMessage = arg.message;
      continue;
    }
    if (arg && typeof arg === "object" && !Array.isArray(arg)) {
      Object.assign(metadata, arg);
    }
  }
  return metadata;
}

function wrapConsoleMethod(
  method: "warn" | "error",
  severity: OpsEventSeverity,
  original: typeof console.warn
) {
  return (...args: unknown[]) => {
    original(...args);
    const first = args.find((arg) => typeof arg === "string");
    if (typeof first === "string" && first.startsWith("[ops-event]")) return;

    logOpsEventSoon({
      severity,
      event: inferEvent(args),
      area: inferArea(args),
      message: args.map(stringifyArg).join(" "),
      metadata: metadataFromArgs(args),
    });
  };
}

export function installOpsConsoleLogger(): void {
  const globalState = globalThis as typeof globalThis & {
    [INSTALLED]?: boolean;
  };
  if (globalState[INSTALLED]) return;
  globalState[INSTALLED] = true;

  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);
  console.warn = wrapConsoleMethod("warn", "warning", originalWarn);
  console.error = wrapConsoleMethod("error", "error", originalError);
}
