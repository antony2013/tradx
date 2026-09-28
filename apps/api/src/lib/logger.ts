export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Record<string, unknown>;

export type Logger = {
  debug: (event: string, message: string, context?: LogContext) => void;
  info: (event: string, message: string, context?: LogContext) => void;
  warn: (event: string, message: string, context?: LogContext) => void;
  error: (event: string, message: string, context?: LogContext) => void;
};

const writers: Record<LogLevel, (...values: unknown[]) => void> = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

function normalize(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map(normalize);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        normalize(nested),
      ]),
    );
  }

  return value;
}

export function createLogger(
  nodeEnv: string = process.env.NODE_ENV ?? 'development',
): Logger {
  const write = (level: LogLevel, event: string, message: string, context: LogContext = {}) => {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      message,
      context: normalize(context),
      nodeEnv,
    };

    writers[level](JSON.stringify(entry));
  };

  return {
    debug: (event, message, context) => write('debug', event, message, context),
    info: (event, message, context) => write('info', event, message, context),
    warn: (event, message, context) => write('warn', event, message, context),
    error: (event, message, context) => write('error', event, message, context),
  };
}
