import { NewTicketUIFactory } from './new-ticket-ui';
import { CONSTANTS } from './constants';
import { ContextManager } from './context';

/**
 * Handles DOM observation for the Freshdesk "New Ticket" page (/a/tickets/new).
 *
 * Purpose:
 * Monitors the new ticket form to inject Atlas Comet's "Definir Serviço" button
 * in the page header. This allows agents to use the same service-selection flow
 * available on existing tickets, but tailored for ticket creation with additional
 * fields (Contato, Origem, Status, Prioridade, Grupo, Agente, Produto, Assunto,
 * Descrição) and independent preference memorization.
 *
 * Architecture:
 * - Uses a MutationObserver + polling fallback (same pattern as TicketObserver)
 * - Detects when the new ticket form is rendered in the DOM
 * - Injects a floating "Definir Serviço" button in the page header area
 * - Re-injects the button if Ember re-renders the container (SPA transitions)
 */
export class NewTicketObserver {
  /** MutationObserver watching the DOM for render changes */
  private observer: MutationObserver | null = null;

  /** Fallback polling interval ID (catches edge cases the observer misses) */
  private pollIntervalId: ReturnType<typeof setInterval> | null = null;

  /** Tracks whether we are currently observing */
  private isActive: boolean = false;

  constructor() {}

  /**
   * Starts observing the DOM for the new ticket form.
   * Sets up a MutationObserver on the page body and a fallback polling interval
   * to ensure the "Definir Serviço" button persists across Ember re-renders.
   */
  public startObserving(): void {
    // Prevent duplicate observation if already active
    if (this.isActive) return;

    this.disconnect(); // Clean any previous observer + interval + UI
    this.isActive = true;

    // Set up the MutationObserver to watch for UI changes
    this.observer = new MutationObserver(() => {
      if (!ContextManager.isValid()) {
        this.disconnect();
        return;
      }
      this.maintainUI();
    });

    // Initial check — the form may already be rendered
    this.maintainUI();

    // Observe the entire body for changes (Ember renders dynamically)
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Fallback polling every 500ms to catch edge cases
    this.pollIntervalId = setInterval(() => {
      if (!ContextManager.isValid()) {
        this.disconnect();
        return;
      }

      // Only maintain if we're still on the new ticket page
      if (this.isActive && window.location.pathname.includes(CONSTANTS.URL.NEW_TICKET_PATH)) {
        this.maintainUI();
      } else {
        this.disconnect();
      }
    }, 500);
  }

  /**
   * Terminates the active observer and removes all injected UI elements.
   * Called when navigating away from the new ticket page.
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
    this.isActive = false;
    this.removeInjectedUI();
  }

  /**
   * Removes all Atlas Comet New Ticket UI elements from the DOM.
   * Prevents orphaned buttons when navigating away from the new ticket page.
   */
  private removeInjectedUI(): void {
    const container = document.getElementById('atlas-comet-newticket-buttons');
    if (container) container.remove();
  }

  /**
   * Ensures the Atlas Comet "Definir Serviço" button is present on the new ticket page.
   *
   * Strategy:
   * 1. Verifies we are still on the /a/tickets/new URL
   * 2. Looks for the page header / action area to inject the button
   * 3. If the button doesn't exist, renders it via NewTicketUIFactory
   */
  private maintainUI(): void {
    // Safety guard: verify we are still on the new ticket page
    const pathname = window.location.pathname;
    if (!pathname.includes(CONSTANTS.URL.NEW_TICKET_PATH)) {
      this.removeInjectedUI();
      return;
    }

    // Check if our button container already exists
    const buttonsExist = document.getElementById('atlas-comet-newticket-buttons');
    if (buttonsExist) return; // Already injected, nothing to do

    // Look for the page header area to inject the button.
    // On the new ticket page, the header contains a "Novo ticket" title and action buttons.
    // We look for multiple possible selectors since Freshdesk may vary across versions.
    const headerContainer =
      document.querySelector('.page-actions__left') ||
      document.querySelector('.ticket-actions') ||
      document.querySelector('.page-header__actions') ||
      document.querySelector('.page-title');

    // Render the button — NewTicketUIFactory handles all positioning logic
    NewTicketUIFactory.renderNewTicketButton(headerContainer as HTMLElement | null);
  }
}


