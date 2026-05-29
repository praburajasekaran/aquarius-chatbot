export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installOpsConsoleLogger } = await import("@/lib/ops-console");
    installOpsConsoleLogger();
  }
}
