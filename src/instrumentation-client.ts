type ClientOpsPayload = {
  event: "client_runtime_error" | "client_unhandled_rejection" | "client_console_warning";
  message: string;
  source?: string;
  stack?: string;
};

const MAX_FIELD_LENGTH = 500;

function trim(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.slice(0, MAX_FIELD_LENGTH);
}

function postClientError(payload: ClientOpsPayload): void {
  try {
    const body = JSON.stringify({
      ...payload,
      message: trim(payload.message) ?? "Client error",
      source: trim(payload.source),
      stack: trim(payload.stack),
      path: trim(window.location.pathname),
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/ops/client-error",
        new Blob([body], { type: "application/json" })
      );
      return;
    }
    void fetch("/api/ops/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Observability must never affect the visitor experience.
  }
}

window.addEventListener("error", (event) => {
  postClientError({
    event: "client_runtime_error",
    message: event.message,
    source: event.filename,
    stack: event.error instanceof Error ? event.error.stack : undefined,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  postClientError({
    event: "client_unhandled_rejection",
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

function wrapConsole(method: "error" | "warn", original: typeof console.error) {
  return (...args: unknown[]) => {
    original(...args);
    postClientError({
      event: method === "warn" ? "client_console_warning" : "client_runtime_error",
      message: args
        .map((arg) => (arg instanceof Error ? arg.message : String(arg)))
        .join(" "),
      source: `console.${method}`,
      stack: args.find((arg): arg is Error => arg instanceof Error)?.stack,
    });
  };
}

console.error = wrapConsole("error", console.error.bind(console));
console.warn = wrapConsole("warn", console.warn.bind(console));
