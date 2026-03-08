import pino, { type Bindings, type Logger, type LoggerOptions } from 'pino'

export type { Logger }

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

let rootLogger = pino({
  level: 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  base: null,
  formatters: {
    level(label) {
      return {
        level: label
      }
    }
  }
})

export function configureLogger(
  options: {
    level?: LogLevel
    service?: string
    base?: Bindings
  } = {}
): Logger {
  const loggerOptions: LoggerOptions = {
    level: options.level ?? 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    base: null,
    formatters: {
      level(label) {
        return {
          level: label
        }
      }
    }
  }

  rootLogger = pino(loggerOptions).child({
    service: options.service ?? 'household',
    ...options.base
  })

  return rootLogger
}

export function getLogger(name: string, bindings: Bindings = {}): Logger {
  return rootLogger.child({
    logger: name,
    ...bindings
  })
}
