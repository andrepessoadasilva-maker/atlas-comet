/* eslint-disable @typescript-eslint/no-explicit-any, prefer-const, no-console, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-unused-vars */
import { CONSTANTS } from './constants';

/**
 * Singleton class responsible for managing the local state of the extension.
 *
 * Purpose:
 * Stores and manages data across the lifecycle of the content script.
 * Crucially, it tracks which tickets have already been processed to prevent
 * duplicate executions or infinite loops within the dynamic Ember SPA environment.
 */
export class AppState {
  private static instance: AppState;

  /**
   * Stores the currently processed ticket ID to avoid redundant modal triggers.
   */
  private currentProcessedTicket: string | null = null;

  /**
   * Flag to indicate if the service level has been manually defined in this session.
   */
  private serviceDefined: boolean = false;

  /**
   * Private constructor to enforce Singleton pattern.
   */
  private constructor() {}

  /**
   * Retrieves the singleton instance of the AppState.
   *
   * @returns {AppState} The current application state instance.
   */
  public static getInstance(): AppState {
    if (!AppState.instance) {
      AppState.instance = new AppState();
    }
    return AppState.instance;
  }

  public setServiceDefined(defined: boolean): void {
    this.serviceDefined = defined;
  }

  public isServiceDefined(): boolean {
    return this.serviceDefined;
  }

  /**
   * Marks a specific ticket ID as fully processed.
   *
   * @param ticketId - The ID of the ticket that was processed.
   */
  public setProcessedTicket(ticketId: string): void {
    this.currentProcessedTicket = ticketId;
  }

  /**
   * Resets the processed ticket cache. Usually called upon navigating to a new ticket.
   */
  public clearProcessedTicket(): void {
    this.currentProcessedTicket = null;
    this.serviceDefined = false;
  }

  /**
   * Checks if a ticket has already been processed in the current session state.
   *
   * @param ticketId - The ID of the ticket to verify.
   * @returns {boolean} True if the ticket was already processed, false otherwise.
   */
  public isTicketProcessed(ticketId: string): boolean {
    return this.currentProcessedTicket === ticketId;
  }

  /**
   * Utility method to safely extract the numerical ticket ID from a Freshdesk URL.
   *
   * @param url - The full URL string.
   * @returns {string | null} The extracted ticket string ID, or null if not a valid ticket URL.
   */
  public extractTicketIdFromUrl(url: string): string | null {
    if (!url.includes(CONSTANTS.URL.TICKETS_PATH)) return null;
    const match = url.match(new RegExp(`${CONSTANTS.URL.TICKETS_PATH}(\\d+)`));
    return match ? match[1] : null;
  }
}


