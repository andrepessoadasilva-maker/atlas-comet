import { CONSTANTS } from './constants';

/**
 * Singleton class responsible for managing the local state of the extension.
 *
 * Purpose:
 * Stores and manages data across the lifecycle of the content script.
 * Crucially, it tracks which tickets have already been processed to prevent
 * duplicate executions or infinite loops within the dynamic Ember SPA environment.
 *
 * Extended to support the Freshdesk Messaging (chat) context, where the agent
 * can pre-select a service before resolving a conversation. The chat selection
 * is stored in-memory and persisted to chrome.storage.local for cross-session
 * resilience (e.g., if the agent navigates away and returns).
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

  // ─── Chat / Messaging State ─────────────────────────────────────────────────

  /**
   * In-memory cache of the service selection made for the current chat conversation.
   * Contains the full hierarchy (Tipo, N1, N2, N3) so it can be applied to the
   * ticket once the chat is resolved.
   */
  private chatServiceSelection: ChatServiceSelection | null = null;

  /**
   * Private constructor to enforce Singleton pattern.
   */
  private constructor() { }

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

  // ─── Chat / Messaging Methods ──────────────────────────────────────────────

  /**
   * Extracts the conversation ID from a Freshdesk Messaging URL.
   *
   * URL format:
   * https://{domain}/crm/messaging/a/{accountId}/inbox/{...}/conversation/{conversationId}
   *
   * @param url - The full URL string.
   * @returns {string | null} The extracted conversation ID, or null if not a valid messaging URL.
   */
  public extractConversationIdFromUrl(url: string): string | null {
    if (!url.includes(CONSTANTS.URL.MESSAGING_PATH)) return null;
    const match = url.match(/\/conversation\/(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * Checks if a URL corresponds to the Freshdesk Messaging (chat) interface.
   *
   * @param url - The full URL string to check.
   * @returns {boolean} True if the URL is a messaging page.
   */
  public isMessagingUrl(url: string): boolean {
    return url.includes(CONSTANTS.URL.MESSAGING_PATH);
  }

  /**
   * Stores the service selection made by the agent for the current chat conversation.
   * Also persists to chrome.storage.local for resilience.
   *
   * @param selection - The full service selection (Tipo, N1, N2, N3) plus conversation ID.
   */
  public setChatServiceSelection(selection: ChatServiceSelection): void {
    this.chatServiceSelection = selection;

    // Sync to sessionStorage for the main world (bridge-inject.js) to read
    try {
      window.sessionStorage.setItem('atlas_chat_service_selection', JSON.stringify(selection));
    } catch {
      // Ignore if sessionStorage is unavailable
    }

    // Persist to chrome.storage.local for cross-navigation resilience
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({
          [CONSTANTS.VALUES.CHAT_SERVICE_STORAGE_KEY]: selection,
        });
      }
    } catch {
      // Storage may fail if context is invalidated; fail silently
    }
  }

  /**
   * Retrieves the current in-memory chat service selection.
   *
   * @returns {ChatServiceSelection | null} The stored selection, or null if none.
   */
  public getChatServiceSelection(): ChatServiceSelection | null {
    return this.chatServiceSelection;
  }

  /**
   * Clears the chat service selection from both memory and persistent storage.
   * Called when navigating away from a conversation or after successful resolution.
   */
  public clearChatServiceSelection(): void {
    this.chatServiceSelection = null;
    
    // Clear from sessionStorage
    try {
      window.sessionStorage.removeItem('atlas_chat_service_selection');
    } catch {
      // Ignore
    }

    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.remove(CONSTANTS.VALUES.CHAT_SERVICE_STORAGE_KEY);
      }
    } catch {
      // Fail silently if context is invalidated
    }
  }

  /**
   * Loads a previously persisted chat service selection from chrome.storage.local.
   * Used on page load to recover state if the agent navigated away and returned.
   *
   * @returns {Promise<ChatServiceSelection | null>} The stored selection, or null if none.
   */
  public async loadChatServiceSelectionFromStorage(): Promise<ChatServiceSelection | null> {
    return new Promise((resolve) => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.get(CONSTANTS.VALUES.CHAT_SERVICE_STORAGE_KEY, (result) => {
            const stored = result[CONSTANTS.VALUES.CHAT_SERVICE_STORAGE_KEY];
            if (stored && typeof stored === 'object' && stored.conversationId) {
              this.chatServiceSelection = stored as ChatServiceSelection;
              
              // Ensure sessionStorage is also synced when loaded from chrome.storage
              try {
                window.sessionStorage.setItem('atlas_chat_service_selection', JSON.stringify(stored));
              } catch {
                /* ignore sessionStorage errors */
              }

              resolve(this.chatServiceSelection);
            } else {
              resolve(null);
            }
          });
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      }
    });
  }
}

// ─── Type Definitions ────────────────────────────────────────────────────────

/**
 * Represents the service selection made by an agent for a chat conversation.
 * Stored in-memory and persisted to chrome.storage.local so it survives
 * SPA navigations and can be applied when the chat is resolved.
 */
export interface ChatServiceSelection {
  /** The Freshdesk Messaging conversation ID (from the URL) */
  conversationId: string;
  /** Ticket type classification (e.g., "Dúvida de Cliente") */
  tipo: string;
  /** Serviço Nível 1 — top-level service category */
  n1: string;
  /** Serviço Nível 2 — mid-level service subcategory */
  n2: string;
  /** Serviço Nível 3 — leaf-level service option (may be empty for N2-only selections) */
  n3: string;
  /** ISO timestamp of when the selection was made */
  timestamp: string;
}
