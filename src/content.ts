import { AppState } from './state';
import { TicketObserver } from './observer';
import { NewTicketObserver } from './new-ticket-observer';
import { CONSTANTS } from './constants';
import { ContextManager } from './context';

// Disable all console logs for production
// const noop = () => {};
// console.log = noop;
// console.info = noop;
// console.warn = noop;
// console.error = noop;
// console.debug = noop;

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
   * Attempts to extract the company name from the Team Inbox page DOM.
   *
   * This method is used by both the Ghost Tab (Route 0) and Legacy Iframe
   * (Route 4) scraping flows. It employs a layered strategy:
   *
   * Strategy 1: Looks for "Conversa iniciada de" text in chat detail elements,
   *             then extracts the company from a tooltip data attribute.
   * Strategy 2: Searches MFE Contact Info widgets (Shadow DOM or light DOM)
   *             for company links or aria-label attributes.
   * Strategy 3: Deep recursive search through all Shadow DOMs for CV CRM /
   *             Anapro custom app links, extracting company from link text.
   *
   * @returns The company name string, or null if not found.
   */
  private tryExtractCompany(): string | null {
    // Strategy 1: Legacy "Conversa iniciada de" in chat details
    const details = Array.from(document.querySelectorAll('.message-detail'));
    for (const el of details) {
      if (el.textContent?.trim().includes('Conversa iniciada de')) {
        const parent = el.closest('.more-details');
        if (parent) {
          const linkSpan = parent.querySelector('span[data-original-title]');
          if (linkSpan) {
            const title = linkSpan.getAttribute('data-original-title');
            if (title) return title.split(' - ')[0].trim();
          }
        }
      }
    }

    // Strategy 2: MFE Contact Info in the right sidebar of Team Inbox
    const mfeWrappers = document.querySelectorAll(
      '#fw-unified-mfe--contact-info, fw-unified-mfe--contact-info, mfe-application[app-id="fw-unified-mfe--contact-info"]'
    );
    for (const mfe of Array.from(mfeWrappers)) {
      const root = mfe.shadowRoot || mfe;
      const companyEl = root.querySelector('a[href*="/companies/"]');
      if (companyEl) {
        const companyText = companyEl.textContent?.trim();
        if (companyText) return companyText;
      }
      const ariaComps = root.querySelectorAll('a[aria-label*="Go to"], a[aria-label*="Ir para"]');
      for (const ariaComp of Array.from(ariaComps)) {
        const ariaMatch = ariaComp.getAttribute('aria-label')?.match(/(?:Go to|Ir para)\s+(.+)/i);
        if (ariaMatch && ariaMatch[1]) {
          const matchText = ariaMatch[1].trim();
          if (!matchText.includes('http')) {
            return matchText;
          }
        }
      }
    }

    // Strategy 3: Recursive Deep Search for Custom App Links (CV CRM / Anapro) anywhere in the DOM
    let foundCustomCompany: string | null = null;
    const searchNode = (node: Document | Element | ShadowRoot) => {
      if (foundCustomCompany) return;

      // Check light DOM of this node
      const customAppComps = node.querySelectorAll('a[href*="cvcrm.com.br"], a[href*="anapro.com.br"]');
      for (const comp of Array.from(customAppComps)) {
        const href = (comp as HTMLAnchorElement).href || '';
        // Apenas pulamos links de ajuda. Desenvolvedor é válido (Isaac).
        if (href.includes('ajuda.cvcrm.com.br') || href.includes('ajuda.anapro.com.br')) {
          continue;
        }
        const customText = comp.textContent?.trim();
        if (customText && customText.includes(' - ')) {
          let extractedCompany = customText.split(' - ')[0].trim();
          if (extractedCompany.startsWith('http')) {
            try {
              const parsedUrl = new URL(extractedCompany);
              extractedCompany = parsedUrl.hostname.split('.')[0];
            } catch (_e) { /* ignore malformed URLs */ }
          }
          foundCustomCompany = extractedCompany;
          return;
        }
      }

      // Traverse shadow DOMs
      const allElements = node.querySelectorAll('*');
      for (const el of Array.from(allElements)) {
        if (el.shadowRoot) {
          searchNode(el.shadowRoot);
        }
      }
    };

    searchNode(document);
    if (foundCustomCompany) return foundCustomCompany;

    return null;
  }

  /**
   * Runs the Ghost Tab scraping flow for Plan C company resolution.
   *
   * Ghost Tabs are invisible top-level tabs created by the background script
   * (via OPEN_GHOST_TAB) specifically to load the Team Inbox SPA page and
   * scrape the company name. They are identified by the `atlas_ghost=1` query
   * parameter appended to the URL.
   *
   * The SPA takes time to render its content, so we poll every 500ms for up
   * to 20 seconds (40 attempts). Once the company is found (or timeout is
   * reached), we send the result back to the background script via
   * GHOST_TAB_RESULT, which forwards it to the original tab's callback.
   * The background script then closes this tab automatically.
   */
  private runGhostTabScraping(): void {
    console.log('[Atlas Comet] Ghost Tab: Polling for company name...');
    let attempts = 0;
    const interval = setInterval(() => {
      const company = this.tryExtractCompany();
      if (company) {
        console.log('[Atlas Comet] Ghost Tab: Company found!', company);
        chrome.runtime.sendMessage({ action: 'GHOST_TAB_RESULT', companyName: company });
        clearInterval(interval);
      } else if (attempts > 40) {
        console.log('[Atlas Comet] Ghost Tab: Timeout after 20s waiting for company name.');
        chrome.runtime.sendMessage({ action: 'GHOST_TAB_RESULT', companyName: null });
        clearInterval(interval);
      }
      attempts++;
    }, 500);
  }

  /**
   * Runs the legacy iframe scraping flow for Plan C company resolution.
   *
   * This flow is for when the Team Inbox page is loaded inside an actual
   * iframe (window !== window.top). It uses the same extraction strategies
   * as the Ghost Tab flow, but communicates the result via window.postMessage
   * to the parent frame instead of chrome.runtime.sendMessage.
   *
   * Kept for backwards compatibility with any remaining iframe-based approaches.
   */
  private runIframeScraping(): void {
    console.log('[Atlas Comet] Running inside Team Inbox iframe. Waiting for chat data...');
    let attempts = 0;
    const interval = setInterval(() => {
      const company = this.tryExtractCompany();
      if (company) {
        window.parent.postMessage({ type: 'ATLAS_COMET_TEAM_INBOX_RESULT', companyName: company }, '*');
        clearInterval(interval);
      } else if (attempts > 40) {
        window.parent.postMessage({ type: 'ATLAS_COMET_TEAM_INBOX_RESULT', companyName: null }, '*');
        clearInterval(interval);
      }
      attempts++;
    }, 500);
  }

  /**
   * Evaluates the current URL to decide if observation is required.
   * Routes to the appropriate observer based on the URL pattern:
   *
   * Route 0: Ghost Tab (atlas_ghost=1) → scrape company and report back
   * Route 1: New Ticket page → NewTicketObserver
   * Route 2: Existing Ticket pages → TicketObserver
   * Route 4: Team Inbox iframe → legacy iframe scraping
   * Route 5: Any other URL → disconnects all observers
   *
   * IMPORTANT: Route 0 (Ghost Tab) MUST be checked FIRST because Ghost Tabs
   * are top-level windows (window === window.top) that would otherwise fall
   * through to Route 5 and be disconnected. The `/a/tickets/new` route MUST
   * be checked BEFORE `/a/tickets/{id}` for clean separation.
   *
   * @param url - The current full URL of the browser window.
   */
  private handleRouting(url: string): void {
    // ─── Route 0: Ghost Tab (Plan C — Company Scraping) ─────────────────
    // Ghost Tabs are top-level windows opened by background.ts with the
    // query parameter ?atlas_ghost=1. They exist ONLY to scrape the
    // company name from the Team Inbox SPA page and report it back.
    // This check MUST come before all other routes because:
    //   1. Ghost Tabs are top-level (window === window.top), so they
    //      would fall through to Route 5 (disconnect all) otherwise.
    //   2. We want to run ONLY the scraping logic — no observers, no UI.
    if (window.location.search.includes('atlas_ghost=1')) {
      console.log('[Atlas Comet] 👻 Ghost Tab detected. Running Plan C scraping...');
      this.runGhostTabScraping();
      return; // Do not initialize any observers or other routes
    }

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

    // ─── Route 4: Team Inbox Iframe (Legacy fallback) ────────────────────
    // Only for actual iframes (window !== window.top). Ghost Tabs are
    // handled by Route 0 above. This legacy path communicates via
    // window.postMessage to the parent frame.
    if (window !== window.top && url.includes('/crm/messaging/')) {
      this.runIframeScraping();
      return;
    }

    // ─── Route 5: No matching page — disconnect everything ───────────────
    this.ticketObserver.disconnect();
    this.newTicketObserver.disconnect();
    this.currentSessionTicketId = null;
    this.appState.clearProcessedTicket();
  }
}

// ==========================================
// NORMAL EXECUTION (MAIN WINDOW & IFRAMES)
// ==========================================
const controller = new ExtensionController();
controller.init();


