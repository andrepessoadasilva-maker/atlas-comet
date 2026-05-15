/**
 * Centralized logging utility for Atlas Comet.
 * 
 * Purpose:
 * Provides a consistent way to log messages, errors, and warnings
 * across the extension, facilitating debugging and monitoring.
 */
export class Logger {
  /**
   * Logs an informational message.
   * @param message - The message to log.
   * @param args - Additional arguments to log.
   */
  public static info(message: string, ...args: unknown[]): void {
    // eslint-disable-next-line no-console
    console.info(message, ...args);
  }

  /**
   * Logs a warning message.
   * @param message - The message to log.
   * @param args - Additional arguments to log.
   */
  public static warn(message: string, ...args: unknown[]): void {
    // eslint-disable-next-line no-console
    console.warn(message, ...args);
  }

  /**
   * Logs an error message.
   * @param message - The message to log.
   * @param args - Additional arguments to log.
   */
  public static error(message: string, ...args: unknown[]): void {
    // eslint-disable-next-line no-console
    console.error(message, ...args);
  }

  /**
   * Logs a debug message.
   * @param message - The message to log.
   * @param args - Additional arguments to log.
   */
  public static log(message: string, ...args: unknown[]): void {
    // eslint-disable-next-line no-console
    console.log(message, ...args);
  }
}
