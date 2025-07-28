/**
 * Centralized logging utility with different log levels
 */
export class Logger {
  private component: string;
  private logLevel: LogLevel;

  constructor(component: string, logLevel: LogLevel = 'info') {
    this.component = component;
    this.logLevel = logLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    return levels[level] >= levels[this.logLevel];
  }

  private formatMessage(level: LogLevel, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const formattedData = data ? ` ${JSON.stringify(data)}` : '';
    return `[${timestamp}] ${level.toUpperCase()} [${this.component}] ${message}${formattedData}`;
  }

  debug(message: string, data?: any): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message, data));
    }
  }

  info(message: string, data?: any): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message, data));
    }
  }

  warn(message: string, data?: any): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, data));
    }
  }

  error(message: string, error?: any): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, error));
    }
  }

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';