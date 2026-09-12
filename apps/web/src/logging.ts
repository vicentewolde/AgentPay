export type LogLevel = "info" | "error";

type LogField = boolean | number | string | null | undefined;

export interface LogFields {
  readonly [key: string]: LogField;
}

/**
 * Writes one structured, non-sensitive line for the platform log sink.
 * `fields` deliberately accepts only primitive values, so a caught driver
 * error cannot accidentally be passed to JSON.stringify with its credentials.
 */
export function log(level: LogLevel, msg: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ level, msg, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

/** Never serialize a caught error: `pg` includes connection credentials on it. */
export function logError(msg: string, error: unknown, fields: LogFields = {}): void {
  const errorMessage = error instanceof Error ? error.message : "unknown error";
  log("error", msg, { ...fields, error: errorMessage });
}
