import { AppState } from './state';
import { TicketObserver } from './observer';
import { ChatObserver } from './chat-observer';
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
 * the observation of Freshdesk tickets AND chat conversations.
 *
 * Routes:
 * - `/a/tickets/{id}` → TicketObserver (existing service definition flow)
 * - `/crm/messaging/.../conversation/{id}` → ChatObserver (new chat service flow)
 * - Any other URL → disconnects all observers to save resources
 */
class ExtensionController {
  private appState: AppState;
  private ticketObserver: TicketObserver;
  private chatObserver: ChatObserver;
  private currentSessionTicketId: string | null = null;
  /** Tracks the active conversation ID to detect SPA transitions between chats */
  private currentSessionConversationId: string | null = null;

  constructor() {
    this.appState = AppState.getInstance();
    this.ticketObserver = new TicketObserver();
    this.chatObserver = new ChatObserver();
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
   * - Ticket pages → TicketObserver
   * - Messaging pages → ChatObserver
   * - Other pages → disconnect all observers
   *
   * Tracks transitions between tickets/conversations to clean up state.
   *
   * @param url - The current full URL of the browser window.
   */
  private handleRouting(url: string): void {
    const ticketId = this.appState.extractTicketIdFromUrl(url);
    const conversationId = this.appState.extractConversationIdFromUrl(url);
    const isMessaging = this.appState.isMessagingUrl(url);

    // ─── Route 1: Ticket Page (/a/tickets/{id}) ──────────────────────────────
    if (ticketId) {
      // Disconnect chat observer if we came from messaging
      this.chatObserver.disconnect();
      this.currentSessionConversationId = null;

      // Track ticket transitions
      if (this.currentSessionTicketId !== ticketId) {
        this.appState.clearProcessedTicket();
        this.currentSessionTicketId = ticketId;
      }
      this.ticketObserver.startObserving(ticketId);
      return;
    }

    // ─── Route 2: Messaging Page (/crm/messaging/.../conversation/{id}) ──────
    if (isMessaging && conversationId) {
      // Disconnect ticket observer if we came from a ticket
      this.ticketObserver.disconnect();
      this.currentSessionTicketId = null;
      this.appState.clearProcessedTicket();

      // Track conversation transitions
      if (this.currentSessionConversationId !== conversationId) {
        this.currentSessionConversationId = conversationId;
      }
      this.chatObserver.startObserving(conversationId);
      return;
    }

    // ─── Route 3: Messaging Page without specific conversation ───────────────
    // User is on the inbox view but hasn't selected a conversation yet.
    // Keep the chat observer running if it was already active (the agent may
    // be switching between conversations in the SPA), otherwise disconnect.
    if (isMessaging && !conversationId) {
      this.ticketObserver.disconnect();
      this.currentSessionTicketId = null;
      this.appState.clearProcessedTicket();
      // Don't disconnect chat observer — the conversation panel might still be visible
      return;
    }

    // ─── Route 4: No matching page — disconnect everything ───────────────────
    this.ticketObserver.disconnect();
    this.chatObserver.disconnect();
    this.currentSessionTicketId = null;
    this.currentSessionConversationId = null;
    this.appState.clearProcessedTicket();
  }
}

// ==========================================
// BOOTSTRAP INTERCEPTION (IFRAME INCEPTION)
// ==========================================

// Verifica se estamos rodando DENTRO de um iframe oculto do Team Inbox (Plano C)
if (window !== window.parent && window.location.href.includes('/crm/messaging/')) {
  // --- INÍCIO DO SCRAPING INVISÍVEL ---

  // Função para extrair a empresa do DOM do SPA
  const extractCompany = (): string | null => {
    const detailLink = document.querySelector('.message-detail-link a');
    if (detailLink && detailLink.textContent?.trim()) {
      const fullText = detailLink.textContent.trim();
      if (fullText.includes('-')) return fullText.split('-')[0].trim();
    }

    const tooltipSpan = document.querySelector('.message-detail-link span[data-original-title]');
    if (tooltipSpan) {
      const titleAttr = tooltipSpan.getAttribute('data-original-title') || '';
      if (titleAttr.includes('-')) return titleAttr.split('-')[0].trim();
    }

    const messageDetail = document.querySelector('.message-detail-link');
    if (messageDetail && messageDetail.textContent?.trim()) {
      const fullText = messageDetail.textContent.trim();
      if (fullText.includes('-')) return fullText.split('-')[0].trim();
    }
    return null;
  };

  // Tenta extrair imediatamente
  let company = extractCompany();
  if (company) {
    window.parent.postMessage({ type: 'ATLAS_COMET_TEAM_INBOX_RESULT', companyName: company }, '*');
  } else {
    // Se não encontrou, usa MutationObserver para aguardar o SPA renderizar (limite de 10s)
    const observer = new MutationObserver((mutations, obs) => {
      company = extractCompany();
      if (company) {
        obs.disconnect();
        window.parent.postMessage(
          { type: 'ATLAS_COMET_TEAM_INBOX_RESULT', companyName: company },
          '*',
        );
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      // Não posta nada, o timeout de 15s no parent resolverá o caso de erro
    }, 10000);
  }

  // HALT: Impede o carregamento da extensão completa dentro do Iframe
} else {
  // ==========================================
  // NORMAL EXECUTION (MAIN WINDOW)
  // ==========================================
  const controller = new ExtensionController();
  controller.init();
}


