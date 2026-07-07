import { CONSTANTS } from './constants';
import { LookupService, LookupEntry } from './lookup';
import { AppState, ChatServiceSelection } from './state';
import { ContextManager } from './context';

/**
 * Secure UI Factory for the Freshdesk Messaging (Chat) interface.
 *
 * Purpose:
 * Generates and manages Atlas Comet UI elements within the chat/messaging page.
 * Unlike the ticket UIFactory, this module does NOT call the Freshdesk API to update
 * tickets — it stores the service selection locally (in-memory + chrome.storage.local)
 * so it can be applied when the conversation is resolved.
 *
 * Security:
 * All DOM nodes are built via deterministic DOM APIs (createElement, textContent).
 * innerHTML is used ONLY for static SVG icons, never for dynamic content.
 */
export class ChatUIFactory {
  /**
   * Base inline style for Atlas Comet buttons — consistent with the ticket UI.
   * Matches the exact style pattern from ui.ts to maintain visual coherence.
   */
  private static readonly BASE_BTN_STYLE =
    'display: inline-flex !important; align-items: center !important; justify-content: center !important; height: 32px !important; padding: 0 12px !important; border-radius: 10px !important; font-size: 14px !important; font-weight: 600 !important; line-height: 1.2 !important; cursor: pointer !important; white-space: nowrap !important; box-sizing: border-box !important; margin: 0 !important; vertical-align: middle !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important; transition: all 0.2s ease-in-out !important;';

  /**
   * Renders the "Definir Serviço" button in the chat interface.
   *
   * Placement strategy:
   * 1. If an action bar container is found (conversation header actions), inserts there.
   * 2. If no container is found, creates a floating button in the top-right corner.
   *
   * The button reuses the existing LookupService and search modal pattern from
   * the ticket flow, but stores the selection locally instead of calling the API.
   *
   * @param conversationId - The current conversation ID.
   * @param actionBar - The detected action bar element, or null for floating mode.
   */
  public static renderChatServiceButton(
    conversationId: string,
    actionBar: Element | null,
  ): void {
    // Prevent duplicate injection
    if (document.getElementById('atlas-comet-chat-buttons')) return;

    // Create the main container for Atlas Comet chat buttons
    const container = document.createElement('div');
    container.id = 'atlas-comet-chat-buttons';

    if (actionBar) {
      // Inline mode: insert inside the modal footer, before the 'Resolver e criar' button
      container.style.cssText =
        'display: inline-flex; align-items: center; gap: 6px; margin-right: 8px; vertical-align: middle;';
      
      const resolveBtn = actionBar.querySelector('#ember1406') || actionBar.querySelector('button.nucleus-button--primary:last-child');
      if (resolveBtn) {
        actionBar.insertBefore(container, resolveBtn);
      } else {
        actionBar.prepend(container);
      }
    } else {
      // Floating mode: fallback
      container.style.cssText =
        'position: fixed; top: 12px; right: 16px; display: inline-flex; align-items: center; gap: 6px; z-index: 99990; height: 32px;';
      document.body.appendChild(container);
    }

    // ─── "Definir Serviço" Button ─────────────────────────────────────────────
    const btnService = document.createElement('button');
    btnService.id = 'atlas-comet-chat-service-btn';
    btnService.type = 'button';
    // Use the native Freshdesk "nucleus" button classes for a seamless look
    btnService.className = 'nucleus-button nucleus-button--primary';
    
    // We can add a slight background override to match Atlas Comet branding, 
    // while keeping the nucleus shape and padding
    btnService.style.cssText =
      'background-color: #29735c !important; border-color: #29735c !important; display: inline-flex; align-items: center; gap: 6px;';

    // Comet icon SVG — brand identity
    const iconSpan = document.createElement('span');
    iconSpan.style.cssText = 'display: inline-flex; align-items: center; flex-shrink: 0;';
    iconSpan.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l7.07 17 2.51-7.39L21 11.07z"/></svg>';
    btnService.appendChild(iconSpan);
    btnService.appendChild(document.createTextNode('Definir Serviço'));

    // Hover effects
    btnService.addEventListener('mouseenter', () => {
      btnService.style.opacity = '0.85';
    });
    btnService.addEventListener('mouseleave', () => {
      btnService.style.opacity = '1';
    });

    // Click handler: open the search modal for service selection
    btnService.onclick = async () => {
      const origText = btnService.textContent;
      btnService.textContent = 'Carregando...';
      btnService.style.pointerEvents = 'none';
      btnService.style.opacity = '0.7';
      try {
        // Always force-refresh data when opening the modal
        await LookupService.init(true);
        this.openChatSearchModal(conversationId);
      } catch (e) {
        console.error('[Atlas Comet Chat] Falha ao iniciar LookupService', e);
        const msg = e instanceof Error ? e.message : String(e);
        alert(
          `Erro ao sincronizar campos do Freshdesk: ${msg}\n\nVerifique sua conexão e tente novamente.`,
        );
      } finally {
        btnService.textContent = '';
        btnService.appendChild(iconSpan);
        btnService.appendChild(document.createTextNode(origText || 'Definir Serviço'));
        btnService.style.pointerEvents = 'auto';
        btnService.style.opacity = '1';
      }
    };

    container.appendChild(btnService);

    // ─── Service Badge (shows selected service) ──────────────────────────────
    // This is created once as a placeholder; updateServiceBadge() controls its content
    const badge = document.createElement('div');
    badge.id = 'atlas-comet-chat-service-badge';
    badge.style.cssText =
      'display: none; align-items: center; gap: 6px; background: #d1fae5; color: #065f46; padding: 4px 10px; border-radius: 8px; font-size: 12px; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; white-space: nowrap; max-width: 400px; overflow: hidden; text-overflow: ellipsis;';
    container.appendChild(badge);
  }

  /**
   * Updates the service badge to show the currently selected service.
   * Shows a compact summary: "✓ N2 > N3" or "✓ N2" if N3 is empty.
   *
   * @param selection - The current chat service selection, or null to hide the badge.
   */
  public static updateServiceBadge(selection: ChatServiceSelection | null): void {
    const badge = document.getElementById('atlas-comet-chat-service-badge');
    if (!badge) return;

    if (!selection) {
      if (badge.style.display !== 'none') {
        badge.style.display = 'none';
        badge.removeAttribute('data-selection-key');
      }
      return;
    }

    // Prevent infinite MutationObserver loops by checking if we already rendered this selection
    const selectionKey = `${selection.conversationId}:${selection.n2}:${selection.n3}`;
    if (badge.getAttribute('data-selection-key') === selectionKey && badge.style.display !== 'none') {
      return;
    }
    badge.setAttribute('data-selection-key', selectionKey);

    // Clear previous content safely
    while (badge.firstChild) badge.removeChild(badge.firstChild);

    // Checkmark icon
    const checkSpan = document.createElement('span');
    checkSpan.style.cssText = 'display: inline-flex; align-items: center; flex-shrink: 0;';
    checkSpan.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    badge.appendChild(checkSpan);

    // Service label text
    const label = document.createElement('span');
    label.style.cssText = 'overflow: hidden; text-overflow: ellipsis;';
    const serviceName = selection.n3 || selection.n2;
    label.textContent = serviceName;
    badge.appendChild(label);

    // Clear button (×) to remove the selection
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.style.cssText =
      'background: none; border: none; color: #065f46; cursor: pointer; padding: 0 0 0 4px; font-size: 14px; font-weight: bold; line-height: 1; opacity: 0.6; transition: opacity 0.15s;';
    clearBtn.textContent = '×';
    clearBtn.title = 'Remover seleção de serviço';
    clearBtn.addEventListener('mouseenter', () => {
      clearBtn.style.opacity = '1';
    });
    clearBtn.addEventListener('mouseleave', () => {
      clearBtn.style.opacity = '0.6';
    });
    clearBtn.onclick = (e) => {
      e.stopPropagation();
      AppState.getInstance().clearChatServiceSelection();
      badge.style.display = 'none';
    };
    badge.appendChild(clearBtn);

    badge.style.display = 'inline-flex';
  }

  // ─── Chat Search Modal ───────────────────────────────────────────────────────

  /**
   * Opens the search modal overlay for service selection in the chat context.
   * Reuses the same visual pattern as the ticket search modal, but the selection
   * handler stores locally instead of calling the Freshdesk API.
   *
   * @param conversationId - The current conversation ID.
   */
  private static openChatSearchModal(conversationId: string): void {
    // Prevent duplicate modals
    if (document.getElementById(CONSTANTS.MODAL_ID)) return;

    const overlay = document.createElement('div');
    overlay.id = CONSTANTS.MODAL_ID;
    overlay.className = 'atlas-modal-overlay';

    const modalBody = document.createElement('div');
    modalBody.className = 'atlas-modal-body atlas-modal-body-search';

    // Close modal when clicking outside
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) {
        overlay.remove();
      }
    });

    overlay.appendChild(modalBody);
    document.body.appendChild(overlay);

    this.renderChatSubjectSearch(modalBody, overlay, conversationId);
  }

  /**
   * Renders the full search interface inside the modal for chat service selection.
   *
   * This is structurally identical to the ticket's renderSubjectSearch(), but the
   * click handler stores the selection locally rather than calling the API.
   *
   * @param modalBody - The modal container element.
   * @param overlay - The overlay element for removal on cancel/success.
   * @param conversationId - The current conversation ID.
   */
  private static renderChatSubjectSearch(
    modalBody: HTMLElement,
    overlay: HTMLElement,
    conversationId: string,
  ): void {
    // Clear existing children safely
    while (modalBody.firstChild) modalBody.removeChild(modalBody.firstChild);

    // ─── Title ─────────────────────────────────────────────────────────────────
    const title = document.createElement('h2');
    title.style.cssText =
      'color: #2d7966; margin: 0 0 12px 0; font-size: 18px; display: flex; align-items: center; gap: 8px;';

    // Brand icon — comet SVG
    const titleIcon = document.createElement('span');
    titleIcon.style.cssText =
      'display: inline-flex; align-items: center; flex-shrink: 0; color: #02ac85;';
    titleIcon.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l7.07 17 2.51-7.39L21 11.07z"/></svg>';
    title.appendChild(titleIcon);
    title.appendChild(document.createTextNode('Definir Serviço do Chat'));
    modalBody.appendChild(title);

    // ─── Critical Error Fallback UI ──────────────────────────────────────────
    if (LookupService.getAllTipos().length === 0) {
      const errorView = document.createElement('div');
      errorView.style.cssText = 'padding: 40px 20px; text-align: center; color: #666;';

      const errorIcon = document.createElement('div');
      errorIcon.style.cssText = 'font-size: 40px; margin-bottom: 15px;';
      errorIcon.textContent = '📡';

      const errorTitle = document.createElement('h3');
      errorTitle.style.cssText = 'margin: 0 0 10px 0; color: #d93025; font-size: 16px;';
      errorTitle.textContent = 'Erro de Sincronização';

      const errorText = document.createElement('p');
      errorText.style.cssText = 'font-size: 13px; line-height: 1.5; margin-bottom: 20px;';
      errorText.textContent =
        'Não foi possível carregar os campos do Freshdesk e não há dados em cache. Verifique sua conexão com o Freshdesk.';

      const btnRetry = document.createElement('button');
      btnRetry.style.cssText =
        'background: #2d7966; color: white; border: none; padding: 10px 24px; border-radius: 6px; cursor: pointer; font-weight: bold;';
      btnRetry.textContent = 'Tentar Sincronizar Agora';
      btnRetry.onclick = () => {
        overlay.remove();
        const startBtn = document.getElementById('atlas-comet-chat-service-btn');
        if (startBtn) startBtn.click();
      };

      errorView.appendChild(errorIcon);
      errorView.appendChild(errorTitle);
      errorView.appendChild(errorText);
      errorView.appendChild(btnRetry);
      modalBody.appendChild(errorView);
      return;
    }

    // ─── Subtitle ──────────────────────────────────────────────────────────────
    const subtitle = document.createElement('p');
    subtitle.style.cssText = 'color: #29735c; font-size: 13px; margin: 0 0 16px 0;';
    subtitle.textContent =
      'Selecione o tipo e o serviço para esta conversa. A seleção será salva e aplicada ao ticket quando a conversa for resolvida.';
    modalBody.appendChild(subtitle);

    // ─── Tipo Search Input ─────────────────────────────────────────────────────
    const tipoLabel = document.createElement('label');
    tipoLabel.style.cssText =
      'display: block; font-size: 13px; font-weight: 600; color: #27675c; margin-bottom: 6px;';
    tipoLabel.textContent = 'Tipo do Ticket:';

    const tipoWrapper = document.createElement('div');
    tipoWrapper.style.cssText = 'position: relative; margin-bottom: 12px;';

    const tipoInput = document.createElement('input');
    tipoInput.type = 'text';
    tipoInput.placeholder = 'Digite para buscar o tipo...';
    tipoInput.value = CONSTANTS.VALUES.DEFAULT_TICKET_TYPE;
    tipoInput.style.cssText = `
      width: 100%; padding: 10px 12px; font-size: 14px; border: 2px solid #ddd;
      border-radius: 6px; outline: none; box-sizing: border-box;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    `;

    const tipoResultsContainer = document.createElement('ul');
    tipoResultsContainer.className = 'atlas-tipo-results';
    tipoResultsContainer.style.display = 'none';

    tipoWrapper.appendChild(tipoInput);
    tipoWrapper.appendChild(tipoResultsContainer);

    // Tipo dropdown logic
    const sortedTipos = [...LookupService.getTipos()].sort((a, b) =>
      a.label.localeCompare(b.label),
    );

    const renderTipoResults = (query: string) => {
      while (tipoResultsContainer.firstChild)
        tipoResultsContainer.removeChild(tipoResultsContainer.firstChild);

      const normalizedQuery = query
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      const filtered = sortedTipos.filter((c) =>
        c.label
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .includes(normalizedQuery),
      );

      if (filtered.length === 0) {
        const emptyItem = document.createElement('li');
        emptyItem.style.cssText =
          'padding: 8px 12px; text-align: center; color: #999; font-size: 13px;';
        emptyItem.textContent = 'Nenhum tipo encontrado.';
        tipoResultsContainer.appendChild(emptyItem);
        return;
      }

      for (const choice of filtered) {
        const li = document.createElement('li');
        li.style.cssText = `
          padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #f0f0f0;
          font-size: 13px; color: #333; transition: background 0.15s ease;
        `;
        li.textContent = choice.label;
        li.addEventListener('mouseenter', () => {
          li.style.background = '#f0f7ff';
        });
        li.addEventListener('mouseleave', () => {
          li.style.background = 'transparent';
        });
        li.onmousedown = (e) => {
          e.preventDefault();
          tipoInput.value = choice.value;
          tipoResultsContainer.style.display = 'none';
        };
        tipoResultsContainer.appendChild(li);
      }
    };

    tipoInput.addEventListener('focus', () => {
      tipoInput.style.borderColor = '#02ac85';
      tipoInput.style.boxShadow = '0 0 0 3px rgba(172, 254, 223, 0.2)';
      tipoResultsContainer.style.display = 'block';
      renderTipoResults(tipoInput.value);
    });
    tipoInput.addEventListener('blur', () => {
      tipoInput.style.borderColor = '#ddd';
      tipoInput.style.boxShadow = 'none';
      tipoResultsContainer.style.display = 'none';
    });
    tipoInput.addEventListener('input', () => {
      renderTipoResults(tipoInput.value);
    });

    // ─── Assunto Search Input ──────────────────────────────────────────────────
    const assuntoLabel = document.createElement('label');
    assuntoLabel.style.cssText =
      'display: block; font-size: 13px; font-weight: 600; color: #27675c; margin-bottom: 6px;';
    assuntoLabel.textContent = 'Buscar Serviço:';

    const searchWrapper = document.createElement('div');
    searchWrapper.style.cssText = 'position: relative;';

    const searchIcon = document.createElement('span');
    searchIcon.style.cssText = `
      position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
      pointer-events: none; display: flex; align-items: center; color: #02ac85;
    `;
    searchIcon.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Digite o assunto...';
    searchInput.style.cssText = `
      width: 100%; padding: 10px 12px 10px 34px; font-size: 14px; border: 2px solid #ddd;
      border-radius: 6px; outline: none; box-sizing: border-box;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    `;

    searchWrapper.appendChild(searchIcon);
    searchWrapper.appendChild(searchInput);

    searchInput.addEventListener('focus', () => {
      searchInput.style.borderColor = '#02ac85';
      searchInput.style.boxShadow = '0 0 0 3px rgba(172, 254, 223, 0.2)';
    });
    searchInput.addEventListener('blur', () => {
      searchInput.style.borderColor = '#ddd';
      searchInput.style.boxShadow = 'none';
    });

    // ─── Level Filter Checkboxes ──────────────────────────────────────────────
    const filterRow = document.createElement('div');
    filterRow.style.cssText = `
      display: flex; align-items: center; gap: 16px; margin: 10px 0 4px 0;
      flex-wrap: wrap;
    `;

    const checkboxLabelStyle =
      'display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: #29735c; cursor: pointer; user-select: none;';

    const cbN3Label = document.createElement('label');
    cbN3Label.style.cssText = checkboxLabelStyle;
    const cbN3 = document.createElement('input');
    cbN3.type = 'checkbox';
    cbN3.checked = true;
    cbN3.style.cssText = 'cursor: pointer; accent-color: #02ac85;';
    cbN3Label.appendChild(cbN3);
    cbN3Label.appendChild(document.createTextNode('Mostrar Serviço Nível 3'));

    const cbN2Label = document.createElement('label');
    cbN2Label.style.cssText = checkboxLabelStyle;
    const cbN2 = document.createElement('input');
    cbN2.type = 'checkbox';
    cbN2.checked = false;
    cbN2.style.cssText = 'cursor: pointer; accent-color: #02ac85;';
    cbN2Label.appendChild(cbN2);
    cbN2Label.appendChild(document.createTextNode('Mostrar Serviço Nível 2'));

    filterRow.appendChild(cbN2Label);
    filterRow.appendChild(cbN3Label);

    // ─── Results Container ─────────────────────────────────────────────────────
    const resultsContainer = document.createElement('ul');
    resultsContainer.className = 'atlas-results-container';

    // ─── Cancel Button ─────────────────────────────────────────────────────────
    const btnCancel = document.createElement('button');
    btnCancel.style.cssText = `
      margin-top: 12px; padding: 10px 20px; background: #888; color: white;
      border: none; cursor: pointer; border-radius: 4px; font-weight: bold;
      align-self: flex-end; transition: background 0.2s ease;
    `;
    btnCancel.textContent = 'Cancelar';
    btnCancel.addEventListener('mouseenter', () => {
      btnCancel.style.background = '#666';
    });
    btnCancel.addEventListener('mouseleave', () => {
      btnCancel.style.background = '#888';
    });
    btnCancel.onclick = () => {
      overlay.remove();
    };

    // ─── Helper: build allowed levels set ──────────────────────────────────────
    const getAllowedLevels = (): Set<number> => {
      const levels = new Set<number>();
      if (cbN3.checked) levels.add(3);
      if (cbN2.checked) levels.add(2);
      return levels;
    };

    // ─── Helper: run search ────────────────────────────────────────────────────
    const runSearch = () => {
      const levels = getAllowedLevels();

      if (levels.size === 0) {
        while (resultsContainer.firstChild)
          resultsContainer.removeChild(resultsContainer.firstChild);
        const warningItem = document.createElement('li');
        warningItem.style.cssText =
          'padding: 24px 16px; text-align: center; color: #999; font-size: 14px;';
        warningItem.textContent =
          '⚠️ Selecione pelo menos um nível (N2 ou N3) para visualizar os assuntos.';
        resultsContainer.appendChild(warningItem);
        return;
      }

      const query = searchInput.value;
      const filtered = LookupService.searchLeaves(query, levels);
      this.renderChatSearchResults(
        resultsContainer,
        filtered,
        overlay,
        conversationId,
        () => tipoInput.value,
        query,
      );
    };

    searchInput.addEventListener('input', runSearch);
    cbN3.addEventListener('change', runSearch);
    cbN2.addEventListener('change', runSearch);

    // Assemble the UI
    modalBody.appendChild(title);
    modalBody.appendChild(subtitle);
    modalBody.appendChild(tipoLabel);
    modalBody.appendChild(tipoWrapper);
    modalBody.appendChild(assuntoLabel);
    modalBody.appendChild(searchWrapper);
    modalBody.appendChild(filterRow);
    modalBody.appendChild(resultsContainer);
    modalBody.appendChild(btnCancel);

    // ─── Load saved preferences ────────────────────────────────────────────────
    if (ContextManager.isValid()) {
      chrome.storage.local.get(['atlas_user_prefs', 'atlas_tipo_pref'], (result) => {
        const prefs = result.atlas_user_prefs;
        if (prefs && typeof prefs === 'object') {
          cbN3.checked = !!prefs.n3;
          cbN2.checked = !!prefs.n2;
        }
        const savedTipo = result.atlas_tipo_pref;
        if (savedTipo && typeof savedTipo === 'string') {
          tipoInput.value = savedTipo;
        }
        runSearch();
        setTimeout(() => searchInput.focus(), 50);
      });
    } else {
      runSearch();
      setTimeout(() => searchInput.focus(), 50);
    }
  }

  /**
   * Renders search result items for the chat context.
   *
   * Each result shows the service label and breadcrumb path. Clicking a result
   * stores the selection locally (NOT via API) and shows a success toast.
   *
   * @param container - The <ul> element to populate.
   * @param results - Matching LookupEntry objects.
   * @param overlay - The overlay element for removal after selection.
   * @param conversationId - The current conversation ID.
   * @param getTicketType - Function to get the current Tipo value.
   * @param query - The current search query for highlighting.
   */
  private static renderChatSearchResults(
    container: HTMLElement,
    results: LookupEntry[],
    overlay: HTMLElement,
    conversationId: string,
    getTicketType: () => string,
    query: string = '',
  ): void {
    // Clear previous results
    while (container.firstChild) container.removeChild(container.firstChild);

    if (results.length === 0) {
      const emptyItem = document.createElement('li');
      emptyItem.style.cssText = 'padding: 16px; text-align: center; color: #999; font-size: 14px;';
      emptyItem.textContent = query.trim()
        ? `Não encontramos nada para "${query}". Que tal tentar palavras-chave mais simples?`
        : 'Nenhum resultado encontrado.';
      container.appendChild(emptyItem);
      return;
    }

    for (const entry of results) {
      const li = document.createElement('li');
      li.style.cssText = `
        padding: 10px 14px; cursor: pointer; border-bottom: 1px solid #f0f0f0;
        transition: background 0.15s ease; margin-bottom: 2px;
      `;

      li.addEventListener('mouseenter', () => {
        li.style.background = '#f0f7ff';
      });
      li.addEventListener('mouseleave', () => {
        li.style.background = 'transparent';
      });

      // ─── Title Row: Assunto Label + N1 Badge ─────────────────────────────
      const titleRow = document.createElement('div');
      titleRow.style.cssText = 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap;';

      const labelSpan = document.createElement('span');
      labelSpan.style.cssText = 'font-size: 14px; font-weight: 600; color: #29735c;';
      this.appendHighlightedText(labelSpan, entry.label, query);
      titleRow.appendChild(labelSpan);

      // N1 Badge with category-specific colors
      const sortedParents = [...(entry.parents || [])].sort((a, b) => a.level - b.level);
      if (sortedParents.length > 0) {
        const n1Label = sortedParents[0].label;
        const n1Lower = n1Label
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase();
        let badgeBg = '#f0f0f0';
        let badgeColor = '#666';

        if (n1Lower.includes('cv prospectar')) {
          badgeBg = '#fde8e8';
          badgeColor = '#b91c1c';
        } else if (n1Lower.includes('cv gerenciar')) {
          badgeBg = '#FFF9C4';
          badgeColor = '#827717';
        } else if (n1Lower.includes('cv vender')) {
          badgeBg = '#d1fae5';
          badgeColor = '#065f46';
        } else if (n1Lower.includes('cv relacionar')) {
          badgeBg = '#dbeafe';
          badgeColor = '#1e40af';
        }

        const badge = document.createElement('span');
        badge.style.cssText = `
          display: inline-block; font-size: 10px; font-weight: 600;
          color: ${badgeColor}; background: ${badgeBg};
          padding: 2px 6px; border-radius: 4px;
          text-transform: uppercase; white-space: nowrap;
          flex-shrink: 0; margin-left: 8px;
        `;
        badge.textContent = n1Label;
        titleRow.appendChild(badge);
      }

      li.appendChild(titleRow);

      // ─── Breadcrumb Path ──────────────────────────────────────────────────
      const breadcrumb = LookupService.getBreadcrumb(entry);
      if (breadcrumb) {
        const fullPath = `${breadcrumb} > ${entry.label}`;
        const breadcrumbSpan = document.createElement('span');
        breadcrumbSpan.style.cssText =
          'display: block; font-size: 11px; color: #999; margin-top: 3px;';
        this.appendHighlightedText(breadcrumbSpan, fullPath, query);
        li.appendChild(breadcrumbSpan);
      }

      // ─── Click Handler: Store Selection Locally ────────────────────────────
      li.addEventListener('click', () => {
        const chain = LookupService.getParentChain(entry.choiceId);
        if (chain.length === 0) {
          console.warn(
            `[Atlas Comet Chat] Could not resolve parent chain for choiceId: ${entry.choiceId}`,
          );
          return;
        }

        const n1 = chain.find((e) => e.level === 1)?.label ?? '';
        const n2 = chain.find((e) => e.level === 2)?.label ?? '';
        const n3 = chain.find((e) => e.level === 3)?.label ?? '';
        const selectedTipo = getTicketType();

        // Build the selection object
        const selection: ChatServiceSelection = {
          conversationId,
          tipo: selectedTipo,
          n1,
          n2,
          n3,
          timestamp: new Date().toISOString(),
        };

        // Store the selection in AppState (in-memory + chrome.storage.local)
        AppState.getInstance().setChatServiceSelection(selection);

        // ─── Show Success Toast (API Interception handles the rest) ────────
        this.showSuccessToast(overlay.querySelector('div'), overlay, selection);

        // ─── Auto-submit the Chat Resolution Modal ─────────────────────────
        // The user shouldn't have to manually click the submit button.
        // We find the primary button in the footer and click it for them.
        setTimeout(() => {
          const footer = document.querySelector(CONSTANTS.SELECTORS.CHAT_RESOLUTION_FOOTER);
          if (footer) {
            // Find all primary buttons in the footer (usually "Resolver E Criar" is the last one)
            const resolveBtns = Array.from(footer.querySelectorAll('button.nucleus-button--primary'));
            const resolveBtn = resolveBtns[resolveBtns.length - 1] as HTMLButtonElement | undefined;
            if (resolveBtn) {
              resolveBtn.click();
            }
          }
        }, 400); // Short delay to let the success toast animation start
      });

      container.appendChild(li);
    }
  }

  private static showSuccessToast(modal: Element | null, overlay: HTMLElement, selection: ChatServiceSelection): void {
    if (!modal) return;
    
    while (modal.firstChild) modal.removeChild(modal.firstChild);

    const finalContainer = document.createElement('div');
    finalContainer.style.cssText = `
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 40px 30px; text-align: center;
      animation: atlas-comet-crossfade 0.3s ease-out forwards;
    `;

    const checkIcon = document.createElement('div');
    checkIcon.style.cssText =
      'width: 200px; height: 200px; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px auto; color: #02ac85;';
    checkIcon.innerHTML = `
      <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="8 12 11 15 16 9"/>
      </svg>
    `;

    const serviceName = selection.n3 || selection.n2;
    const successText = document.createElement('p');
    successText.style.cssText =
      'color: #29735c; font-size: 15px; font-weight: 500; margin: 0;';
    successText.textContent = `Serviço definido: ${serviceName}`;

    const hintText = document.createElement('p');
    hintText.style.cssText =
      'color: #888; font-size: 12px; margin: 8px 0 0 0;';
    hintText.textContent =
      'O serviço será aplicado ao ticket silenciosamente quando você resolver a conversa.';

    finalContainer.appendChild(checkIcon);
    finalContainer.appendChild(successText);
    finalContainer.appendChild(hintText);
    modal.appendChild(finalContainer);

    this.updateServiceBadge(selection);

    setTimeout(() => overlay.remove(), 1500);
  }

  // ─── Text Highlighting Helper ───────────────────────────────────────────────

  /**
   * Securely highlights search query matches within text.
   * Multi-token aware, accent-insensitive, case-insensitive.
   * Identical algorithm to UIFactory.appendHighlightedText().
   *
   * @param container - Element to append highlighted text nodes into.
   * @param text - Original text to display (preserving accents/case).
   * @param query - Raw search query for matching.
   */
  private static appendHighlightedText(container: HTMLElement, text: string, query: string): void {
    if (!query.trim()) {
      container.textContent = text;
      return;
    }

    const tokens = query
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/-/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0);

    if (tokens.length === 0) {
      container.textContent = text;
      return;
    }

    // Build character-level mapping from original to normalized text
    const normChars: string[] = [];
    const origToNorm: number[] = [];

    for (let i = 0; i < text.length; i++) {
      const origChar = text[i];
      const normChar = origChar
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/-/g, ' ')
        .toLowerCase();
      origToNorm.push(normChars.length);
      for (const c of normChar) {
        normChars.push(c);
      }
    }

    const normalizedText = normChars.join('');
    const matchMaskNorm = new Array(normalizedText.length).fill(false);

    for (const token of tokens) {
      let startIndex = 0;
      let index;
      while ((index = normalizedText.indexOf(token, startIndex)) !== -1) {
        for (let j = 0; j < token.length; j++) {
          matchMaskNorm[index + j] = true;
        }
        startIndex = index + token.length;
      }
    }

    const matchMask = new Array(text.length).fill(false);
    for (let i = 0; i < text.length; i++) {
      const normIdx = origToNorm[i];
      const nextNormIdx = i + 1 < text.length ? origToNorm[i + 1] : normalizedText.length;
      for (let n = normIdx; n < nextNormIdx; n++) {
        if (matchMaskNorm[n]) {
          matchMask[i] = true;
          break;
        }
      }
    }

    let currentIsMatch = matchMask[0];
    let currentChunkStart = 0;

    for (let i = 1; i <= text.length; i++) {
      if (i === text.length || matchMask[i] !== currentIsMatch) {
        const chunk = text.slice(currentChunkStart, i);
        if (currentIsMatch) {
          const strong = document.createElement('strong');
          strong.textContent = chunk;
          strong.style.color = '#02ac85';
          container.appendChild(strong);
        } else {
          container.appendChild(document.createTextNode(chunk));
        }
        if (i < text.length) {
          currentIsMatch = matchMask[i];
          currentChunkStart = i;
        }
      }
    }
  }
}
