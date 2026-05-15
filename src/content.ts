import { AppState } from './state';
import { TicketObserver } from './observer';
import { CONSTANTS } from './constants';
import { ContextManager } from './context';

/**
 * Main entry point for the content script.
 * 
 * Purpose:
 * Bootstraps the application within the isolated world of the webpage.
 * It manages the lifecycle of the extension by listening to navigation events 
 * (from the background script and local window events) and coordinating 
 * the observation of Freshdesk tickets.
 */
class ExtensionController {
  private appState: AppState;
  private ticketObserver: TicketObserver;
  private currentSessionTicketId: string | null = null;

  constructor() {
    this.appState = AppState.getInstance();
    this.ticketObserver = new TicketObserver();
  }

  /**
   * Starts the regular workflow of the extension.
   * Sets up all necessary listeners and checks the current URL.
   */
  public init(): void {
    ContextManager.setupGlobalProtection();
    this.setupMessageListener();
    this.handleRouting(window.location.href);
  }

  /**
   * Sets up listeners for external navigation events (Background script Chrome messages)
   * and internal navigation events (SPA popstate).
   */
  private setupMessageListener(): void {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
   * Tracks ticket transitions to clean up previously observed states.
   * 
   * @param url - The current full URL of the browser window.
   */
  private handleRouting(url: string): void {
    const ticketId = this.appState.extractTicketIdFromUrl(url);

    // If we've navigated to a different ticket (or home), clear the processed cache
    if (this.currentSessionTicketId !== ticketId) {
      this.appState.clearProcessedTicket();
      this.currentSessionTicketId = ticketId;
    }

    if (ticketId) {
      this.ticketObserver.startObserving(ticketId);
    } else {
      // Not a ticket page, disconnect observer to save resources
      this.ticketObserver.disconnect();
    }
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
        window.parent.postMessage({ type: 'ATLAS_COMET_TEAM_INBOX_RESULT', companyName: company }, '*');
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
