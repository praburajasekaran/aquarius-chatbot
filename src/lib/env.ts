export class MissingEnvironmentVariableError extends Error {
  constructor(name: string) {
    super(`Missing required environment variable: ${name}`);
    this.name = "MissingEnvironmentVariableError";
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new MissingEnvironmentVariableError(name);
  }
  return value;
}
