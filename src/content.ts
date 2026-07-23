import { AppState } from './state';
import { TicketObserver } from './observer';
import { NewTicketObserver } from './new-ticket-observer';
import { CONSTANTS } from './constants';
import { ContextManager } from './context';

// Disable all console logs for production
const noop = () => {};
console.log = noop;
console.info = noop;
console.warn = noop;
console.error = noop;
console.debug = noop;

/**
 * Main entry point for the content script.
 *
 * Purpose:
 * Bootstraps the application within the isolated world of the webpage.
 * It manages the lifecycle of the extension by listening to navigation events
 * (from the background script and local window events) and coordinating
 * the observation of Freshdesk tickets and the New Ticket page.
 *
 * Routes:
 * - `/a/tickets/new` → NewTicketObserver (new ticket creation form)
 * - `/a/tickets/{id}` → TicketObserver (existing service definition flow)
 * - Any other URL → disconnects all observers to save resources
 */
class ExtensionController {
  private appState: AppState;
  private ticketObserver: TicketObserver;
  private newTicketObserver: NewTicketObserver;
  private currentSessionTicketId: string | null = null;

  constructor() {
    this.appState = AppState.getInstance();
    this.ticketObserver = new TicketObserver();
    this.newTicketObserver = new NewTicketObserver();
  }

  /**
   * Starts the regular workflow of the extension.
   * Sets up all necessary listeners and checks the current URL.
   */
  public init(): void {
    console.log(`[Atlas Comet] 🚀 Extensão inicializada! Versão da build: ${new Date().getTime()}`);
    ContextManager.setupGlobalProtection();
    this.setupMessageListener();
    this.handleRouting(window.location.href);
  }

  /**
   * Sets up listeners for external navigation events (Background script Chrome messages)
   * and internal navigation events (SPA popstate).
   */
  private setupMessageListener(): void {
    chrome.runtime.onMessage.addListener((message) => {
      if (!ContextManager.isValid()) return;
      if (message.type === CONSTANTS.EVENTS.NAVIGATED) {
        // CRITICAL GUARD: The background script fires onHistoryStateUpdated for ALL
        // frames in the tab. Without this guard, handleRouting() would
        // interpret iframe navigations as user navigations and destroy the
        // current observer state.
        //
        // Fix: Only act on NAVIGATED messages that match the actual top-level window
        // URL. If the message URL differs from window.location.href, it came from
        // an iframe navigation and must be ignored.
        const messageUrl = new URL(message.url);
        const currentUrl = new URL(window.location.href);
        if (messageUrl.pathname !== currentUrl.pathname) {
          // This navigation happened in a sub-frame, not
          // the main window. Ignore it to preserve the current observer state.
          return;
        }
        this.handleRouting(message.url);
      }
    });

    // Also listen to SPA popstate for complete Back/Forward reliability
    window.addEventListener('popstate', () => {
      if (!ContextManager.isValid()) return;
      this.handleRouting(window.location.href);
    });
  }

  /**
   * Evaluates the current URL to decide if observation is required.
   * Routes to the appropriate observer based on the URL pattern:
   * - New Ticket page → NewTicketObserver
   * - Existing Ticket pages → TicketObserver
   * - Other pages → disconnect all observers
   *
   * IMPORTANT: The `/a/tickets/new` route MUST be checked BEFORE the
   * `/a/tickets/{id}` route, because the regex for numeric ticket IDs
   * would NOT match "new", but we need a clean separation.
   *
   * @param url - The current full URL of the browser window.
   */
  private handleRouting(url: string): void {
    const isNewTicket = this.appState.isNewTicketUrl(url);
    const ticketId = this.appState.extractTicketIdFromUrl(url);

    // ─── Route 1: New Ticket Page (/a/tickets/new) ───────────────────────
    if (isNewTicket) {
      this.ticketObserver.disconnect();
      this.currentSessionTicketId = null;
      this.appState.clearProcessedTicket();
      this.newTicketObserver.startObserving();
      return;
    }

    // ─── Route 2: Existing Ticket Page (/a/tickets/{id}) ─────────────────
    if (ticketId) {
      this.newTicketObserver.disconnect();

      // Track ticket transitions
      if (this.currentSessionTicketId !== ticketId) {
        this.appState.clearProcessedTicket();
        this.currentSessionTicketId = ticketId;
      }
      this.ticketObserver.startObserving(ticketId);
      return;
    }

    // ─── Route 3: No matching page — disconnect everything ───────────────
    this.ticketObserver.disconnect();
    this.newTicketObserver.disconnect();
    this.currentSessionTicketId = null;
    this.appState.clearProcessedTicket();
  }
}

// ==========================================
// NORMAL EXECUTION (MAIN WINDOW)
// ==========================================
// Note: The identity resolution in ui.ts uses API V2 calls to resolve
// company names (ticket → requester → contact → company). The previous
// iframe-based Team Inbox scraping ("Plano C") was removed in v1.5.22
// due to its 5-15 second latency; the API chain resolves in ~200-600ms.
const controller = new ExtensionController();
controller.init();


