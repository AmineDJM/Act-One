import { redact } from '@act-one/providers';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured, one line per event, and scrubbed.
 *
 * An ingestion touches a customer's site through a vendor whose connect
 * addresses carry signing keys, so every string field goes through the same
 * redaction as the provider errors before it can reach a log.
 */
export type IngestionLogger = {
  log(level: LogLevel, event: string, fields?: Record<string, unknown>): void;
};

export function scrubFields(fields: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = typeof value === 'string' ? redact(value).slice(0, 2000) : value;
  }
  return out;
}

export const consoleLogger: IngestionLogger = {
  log(level, event, fields) {
    const line = `[ingestion] ${JSON.stringify({ level, event, ...scrubFields(fields) })}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else if (level === 'info') console.log(line);
  },
};

export const silentLogger: IngestionLogger = { log: () => undefined };
