import { AppState } from './state';
import { UIFactory } from './ui';
import { CONSTANTS } from './constants';
import { ContextManager } from './context';

/**
 * Handles DOM observation to detect dynamically rendered Freshdesk elements.
 *
 * Purpose:
 * Replaces legacy setInterval polling with an efficient, micro-targeted MutationObserver.
 * It ensures Atlas Comet buttons are injected and persist in the header, even if
 * Ember re-renders the DOM during SPA transitions.
 */
export class TicketObserver {
  private observer: MutationObserver | null = null;
  /** Stores the fallback polling interval ID so disconnect() can clean it up */
  private pollIntervalId: ReturnType<typeof setInterval> | null = null;
  private appState: AppState;
  private currentTicketId: string | null = null;

  constructor() {
    this.appState = AppState.getInstance();
  }

  /**
   * Starts observing the DOM for mutations to maintain the Atlas Comet UI.
   *
   * @param ticketId - The ID of the current ticket being observed.
   */
  public startObserving(ticketId: string): void {
    this.disconnect(); // Clean any previous observer + interval + UI.
    this.currentTicketId = ticketId; // Set AFTER disconnect to avoid nullification.

    this.observer = new MutationObserver(() => {
      if (!ContextManager.isValid()) {
        this.disconnect();
        return;
      }
      this.maintainUI(ticketId);
    });

    // Initial check
    this.maintainUI(ticketId);

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Fallback polling (every 500ms) to catch manual edits that might not trigger mutations
    // in complex SPA environments. Stored as class property so disconnect() can clean it.
    this.pollIntervalId = setInterval(() => {
      if (!ContextManager.isValid()) {
        this.disconnect();
        return;
      }

      if (this.currentTicketId === ticketId) {
        this.maintainUI(ticketId);
      } else {
        clearInterval(this.pollIntervalId!);
        this.pollIntervalId = null;
      }
    }, 500);
  }

  /**
   * Terminate the active observer and remove all injected UI elements.
   * Called when navigating away from a ticket page or to a different ticket.
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
    this.currentTicketId = null;
    this.removeInjectedUI();
  }

  /**
   * Removes all Atlas Comet UI elements from the DOM.
   * Called during disconnect to ensure no orphaned buttons remain
   * when navigating away from ticket pages (e.g., to dashboard or search).
   */
  private removeInjectedUI(): void {
    const container = document.getElementById('atlas-comet-header-buttons');
    if (container) container.remove();

    const offlineLabel = document.getElementById('atlas-comet-offline-label');
    if (offlineLabel) offlineLabel.remove();
  }

  /**
   * Ensures the Atlas Comet buttons are present in the header.
   * Also checks for the "Chat Offline" status to show the specific warning.
   *
   * @param ticketId - The current ticket ID.
   */
  private maintainUI(ticketId: string): void {
    // Safety guard: verify we are still on a valid ticket page before injecting UI.
    // Freshdesk's SPA can replace the DOM while the observer is still active,
    // so we validate the URL on every mutation to prevent buttons appearing
    // on non-ticket views (dashboard, search filters, etc.).
    const pathname = window.location.pathname;
    if (!pathname.match(/\/a\/tickets\/\d+/)) {
      this.removeInjectedUI();
      return;
    }

    // 1. Check if we need to inject or re-inject buttons
    const headerContainer =
      document.querySelector('.page-actions__left') ||
      document.querySelector('.ticket-details-header .action-bar');

    if (!headerContainer) return;

    // Single evaluation of offline status to avoid redundant DOM traversals
    const isOffline = this.detectOfflineStatus();
    const buttonsExist = document.getElementById('atlas-comet-header-buttons');

    // If buttons don't exist, we must render them.
    if (!buttonsExist) {
      UIFactory.renderHeaderButtons(ticketId, isOffline);
    } else {
      // If buttons already exist, check if we need to show/hide the "Sim, Offline" button
      // based on latest field data or manual definition.
      const hasDefined = this.appState.isServiceDefined();

      // renderHeaderButtons is idempotent and handles internal tag/button logic
      UIFactory.renderHeaderButtons(ticketId, isOffline && !hasDefined);
    }
  }

  /**
   * Detects if the current ticket is marked as "Chat Offline".
   * We check "Tipo", "Serviço Nível 2" and "Serviço Nível 3" property values.
   */
  private detectOfflineStatus(): boolean {
    const levelSelectors = [
      `div[data-test-id="${CONSTANTS.VALUES.TIPO_TITLE}"]`,
      `div[data-test-id="${CONSTANTS.VALUES.NIVEL_2_TITLE}"]`,
      `div[data-test-id="${CONSTANTS.VALUES.NIVEL_3_TITLE}"]`,
    ];

    for (const selector of levelSelectors) {
      const container = document.querySelector(selector);
      if (container) {
        const spanValor = container.querySelector(
          CONSTANTS.SELECTORS.POWER_SELECT_SELECTED,
        ) as HTMLElement;
        if (spanValor && spanValor.innerText.trim() === CONSTANTS.VALUES.CHAT_OFFLINE) {
          return true;
        }
      }
    }

    return false;
  }
}


