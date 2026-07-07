import { AppState } from './state';
import { ChatUIFactory } from './chat-ui';
import { CONSTANTS } from './constants';
import { ContextManager } from './context';

/**
 * Handles DOM observation for the Freshdesk Messaging (chat) interface.
 *
 * Purpose:
 * Monitors the chat/messaging UI to inject Atlas Comet's "Definir Serviço" button
 * and service badge. Unlike the ticket observer, the chat observer does NOT modify
 * ticket data directly — it stores the service selection locally so it can be
 * applied when the conversation is resolved and a ticket is created.
 *
 * Architecture:
 * - Uses a MutationObserver on the messaging page body to detect when the
 *   conversation header/actions area is rendered.
 * - Re-injects the button if Ember re-renders the container (SPA transitions).
 * - Tracks the current conversation ID from the URL and clears state on navigation.
 */
export class ChatObserver {
  /** MutationObserver watching the chat DOM for render changes */
  private observer: MutationObserver | null = null;

  /** Fallback polling interval ID (catches edge cases the observer misses) */
  private pollIntervalId: ReturnType<typeof setInterval> | null = null;

  /** The conversation ID currently being observed */
  private currentConversationId: string | null = null;

  /** Reference to the shared application state singleton */
  private appState: AppState;

  constructor() {
    this.appState = AppState.getInstance();
  }

  /**
   * Starts observing the Freshdesk Messaging DOM for a specific conversation.
   *
   * Sets up a MutationObserver on the page body and a fallback polling interval
   * to ensure the "Definir Serviço" button persists across Ember re-renders.
   *
   * @param conversationId - The conversation ID extracted from the messaging URL.
   */
  public startObserving(conversationId: string): void {
    // Clean any previous observer and UI before rebinding
    this.disconnect();
    this.currentConversationId = conversationId;

    // Load any previously stored service selection for this conversation
    this.appState.loadChatServiceSelectionFromStorage().then((stored) => {
      // If we have a stored selection for a DIFFERENT conversation, clear it
      if (stored && stored.conversationId !== conversationId) {
        this.appState.clearChatServiceSelection();
      }
    });

    // Set up the MutationObserver to watch for UI changes
    this.observer = new MutationObserver(() => {
      if (!ContextManager.isValid()) {
        this.disconnect();
        return;
      }
      this.maintainUI(conversationId);
    });

    // Initial check — the container may already be rendered
    this.maintainUI(conversationId);

    // Observe the entire body for changes (Ember's messaging app renders dynamically)
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Fallback polling every 500ms to catch manual edits or complex SPA transitions
    this.pollIntervalId = setInterval(() => {
      if (!ContextManager.isValid()) {
        this.disconnect();
        return;
      }

      if (this.currentConversationId === conversationId) {
        this.maintainUI(conversationId);
      } else {
        if (this.pollIntervalId !== null) {
          clearInterval(this.pollIntervalId);
          this.pollIntervalId = null;
        }
      }
    }, 500);
  }

  /**
   * Terminates the active observer and removes all injected chat UI elements.
   * Called when navigating away from a conversation or to a different one.
   */
  public disconnect(): void {
    if (this.pollIntervalId !== null) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.currentConversationId = null;
    this.removeInjectedUI();
  }

  /**
   * Removes all Atlas Comet chat UI elements from the DOM.
   * Prevents orphaned buttons when navigating away from a conversation.
   */
  private removeInjectedUI(): void {
    const container = document.getElementById('atlas-comet-chat-buttons');
    if (container) container.remove();

    const badge = document.getElementById('atlas-comet-chat-service-badge');
    if (badge) badge.remove();
  }

  /**
   * Ensures the Atlas Comet "Definir Serviço" button is present in the chat UI.
   *
   * Strategy:
   * 1. Looks for the Freshdesk Chat Resolution Modal Footer (where the "Resolver e criar" button is).
   * 2. If the footer is present, injects our button next to it.
   * 3. Checks if the button already exists to avoid duplication.
   * 4. Updates the service badge if a selection has been made.
   *
   * @param conversationId - The current conversation ID.
   */
  private maintainUI(conversationId: string): void {
    // Safety guard: verify we are still on a messaging page
    const pathname = window.location.pathname;
    if (!pathname.includes(CONSTANTS.URL.MESSAGING_PATH)) {
      this.removeInjectedUI();
      return;
    }

    // Check if our button container already exists
    const buttonsExist = document.getElementById('atlas-comet-chat-buttons');

    // Try to find the chat resolution modal footer
    const modalFooter = document.querySelector(CONSTANTS.SELECTORS.CHAT_RESOLUTION_FOOTER);

    if (modalFooter) {
      if (!buttonsExist) {
        // Render the button inside the resolution modal footer
        ChatUIFactory.renderChatServiceButton(conversationId, modalFooter);
      }
    } else {
      // If modal is closed, remove our injected UI to clean up
      this.removeInjectedUI();
    }

    // Always update the service badge to reflect the current selection state,
    // provided the container actually exists in the DOM right now.
    if (document.getElementById('atlas-comet-chat-buttons')) {
      const selection = this.appState.getChatServiceSelection();
      if (selection && selection.conversationId === conversationId) {
        ChatUIFactory.updateServiceBadge(selection);
      }
    }
  }
}
