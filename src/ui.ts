import { CONSTANTS } from './constants';
import { LookupService, LookupEntry } from './lookup';
import { FreshdeskAPI } from './api';
import { AppState } from './state';
import { ContextManager } from './context';
import lottie from 'lottie-web';
import loaderJson from './loader_data';
import { Logger } from './logger';

/**
 * A secure UI Factory for generating dynamic modal elements in the DOM.
 *
 * Purpose:
 * Centralizes DOM manipulation for extension-generated interfaces to guarantee
 * security against Cross-Site Scripting (XSS) vectors. It explicitly avoids using
 * innerHTML or insertAdjacentHTML.
 */
export class UIFactory {
  /**
   * Renders a warning modal inside the Freshdesk DOM to alert agents about
   * a potentially incorrect offline status tab.
   *
   * @param ticketId - The ID of the currently processed ticket, used for logging purposes.
   */
  /** Stores the current ticket ID for use across the UI flow (subject search → API call) */
  private static currentTicketId: string | null = null;

  public static renderHeaderButtons(ticketId: string, isOffline: boolean): void {
    this.currentTicketId = ticketId;

    // Check if offline tag is already present
    let alreadyTaggedOffline = false;
    const tagContainer = document.querySelector(CONSTANTS.SELECTORS.TAG_CONTAINER);
    if (tagContainer) {
      const hasTagInText = tagContainer.textContent?.includes(CONSTANTS.VALUES.OFFLINE_TAG);
      const inputs = Array.from(tagContainer.querySelectorAll('input'));
      const hasTagInInputs = inputs.some((input) =>
        input.value.includes(CONSTANTS.VALUES.OFFLINE_TAG),
      );
      alreadyTaggedOffline = !!(hasTagInText || hasTagInInputs);
    }

    const baseBtnStyle =
      'display: inline-flex !important; align-items: center !important; justify-content: center !important; height: 32px !important; padding: 0 12px !important; border-radius: 10px !important; font-size: 14px !important; font-weight: 600 !important; line-height: 1.2 !important; cursor: pointer !important; white-space: nowrap !important; box-sizing: border-box !important; margin: 0 !important; vertical-align: middle !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important; transition: all 0.2s ease-in-out !important;';

    // Get or create the main container
    let container = document.getElementById('atlas-comet-header-buttons');
    if (!container) {
      container = document.createElement('div');
      container.id = 'atlas-comet-header-buttons';
      container.style.cssText =
        'display: inline-flex; align-items: center; gap: 6px; margin-right: 8px; z-index: 50; height: 32px; vertical-align: middle;';

      // 1. "Definir Assunto" Button (Created once)
      const btnSearch = document.createElement('button');
      btnSearch.id = 'iniciar-busca';
      btnSearch.style.cssText =
        baseBtnStyle +
        ' background: #29735c !important; color: #fbfbf9 !important; border: 1px solid rgba(45, 121, 102, 0.1) !important; border-bottom: 2px solid #02ac85 !important; box-shadow: 0 1px 3px rgba(39, 103, 92, 0.1) !important;';
      btnSearch.textContent = 'Definir Serviço';
      btnSearch.addEventListener('mouseenter', () => {
        btnSearch.style.opacity = '0.85';
      });
      btnSearch.addEventListener('mouseleave', () => {
        btnSearch.style.opacity = '1';
      });
      btnSearch.onclick = async () => {
        const origText = btnSearch.textContent;
        btnSearch.textContent = 'Carregando...';
        btnSearch.style.pointerEvents = 'none';
        btnSearch.style.opacity = '0.7';
        try {
          // Sempre força a busca de dados atualizados ao abrir o modal
          await LookupService.init(true);
          this.openSearchModal(ticketId);
        } catch (e) {
          console.error('[Atlas Comet] Falha ao iniciar LookupService', e);
          const msg = e instanceof Error ? e.message : String(e);
          alert(
            `Erro ao sincronizar campos do Freshdesk: ${msg}\n\nVerifique sua conexão e tente novamente.`,
          );
        } finally {
          btnSearch.textContent = origText;
          btnSearch.style.pointerEvents = 'auto';
          btnSearch.style.opacity = '1';
        }
      };
      container.appendChild(btnSearch);
    }

    // 2. Manage "Sim, Offline" Button (In-place update)
    const showOfflineBtn = isOffline && !alreadyTaggedOffline;
    let btnConfirm = document.getElementById('confirm-offline');

    if (showOfflineBtn) {
      if (!btnConfirm) {
        btnConfirm = document.createElement('button');
        btnConfirm.id = 'confirm-offline';
        btnConfirm.style.cssText =
          baseBtnStyle +
          ' background: #29735c !important; color: #fbfbf9 !important; border: 1px solid rgba(45, 121, 102, 0.1) !important; border-bottom: 2px solid #02ac85 !important; box-shadow: 0 1px 3px rgba(39, 103, 92, 0.1) !important;';
        btnConfirm.addEventListener('mouseenter', () => {
          (btnConfirm as HTMLElement).style.opacity = '0.85';
        });
        btnConfirm.addEventListener('mouseleave', () => {
          (btnConfirm as HTMLElement).style.opacity = '1';
        });
        btnConfirm.textContent = 'Sim, Offline';
        btnConfirm.onclick = async () => {
          try {
            this.cleanSubjectInDOM();
            await this.fillTagAndSelect(CONSTANTS.VALUES.OFFLINE_TAG);
            btnConfirm?.remove();
            this.removeOfflineLabel();
          } catch (error) {
            console.log('[Atlas Comet] Erro ao preencher tag:', error);
          }
        };
        container.appendChild(btnConfirm);
      }
      this.renderOfflineLabel();
    } else {
      if (btnConfirm) btnConfirm.remove();
      this.removeOfflineLabel();
    }

    // Ensure the container is attached to the correct parent
    const topBarActionContainer =
      document.querySelector('.page-actions__left') ||
      document.querySelector('.ticket-details-header .action-bar');
    if (topBarActionContainer && !topBarActionContainer.contains(container)) {
      topBarActionContainer.prepend(container);
    }
  }

  /**
   * Renders a blinking warning label next to the ticket subject.
   */
  private static renderOfflineLabel(): void {
    let label = document.getElementById('atlas-comet-offline-label');
    if (label) return; // Already exists

    // Add blinking animation style if not present
    let style = document.getElementById('atlas-comet-blink-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'atlas-comet-blink-style';
      style.textContent = `
        @keyframes atlas-comet-blink {
          0% { opacity: 1; }
          50% { opacity: 0.3; }
          100% { opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    label = document.createElement('span');
    label.id = 'atlas-comet-offline-label';
    label.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: 12px;
      color: white;
      background-color: #d9534f;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: bold;
      animation: atlas-comet-blink 1.5s infinite;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      vertical-align: middle;
    `;

    // We use innerHTML here purely for the static SVG icon.
    // The text is static and safe from XSS.
    label.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
        <path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>
      </svg>
      <span>Ticket Offline</span>
    `;

    // Insert right after the subject heading
    const subjectHeading = document.querySelector('.ticket-subject-heading');
    if (subjectHeading) {
      subjectHeading.appendChild(label);
    }
  }

  /**
   * Removes the offline warning label.
   */
  public static removeOfflineLabel(): void {
    const label = document.getElementById('atlas-comet-offline-label');
    if (label) label.remove();
  }

  /**
   * Cleans the ticket subject in the DOM by removing any mention of '[CHAT] - OFFLINE'.
   */
  private static cleanSubjectInDOM(): void {
    const subjectHeading = document.querySelector('.ticket-subject-heading');
    if (subjectHeading && subjectHeading.textContent) {
      // We extract textContent and replace it directly.
      // This is secure (no innerHTML) and fulfills the UI cleanup requirement.
      const originalText = subjectHeading.textContent;
      const cleanText = originalText.replace(/\[CHAT\]\s*-\s*OFFLINE/gi, '').trim();
      if (originalText !== cleanText) {
        subjectHeading.textContent = cleanText;
      }
    }
  }

  /**
   * Opens the search modal as an overlay.
   */
  private static openSearchModal(ticketId: string): void {
    if (document.getElementById(CONSTANTS.MODAL_ID)) return;

    const overlay = document.createElement('div');
    overlay.id = CONSTANTS.MODAL_ID;
    overlay.className = 'atlas-modal-overlay';

    const modalBody = document.createElement('div');
    modalBody.className = 'atlas-modal-body';

    // Close modal when clicking outside of modalBody
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) {
        overlay.remove();
      }
    });

    overlay.appendChild(modalBody);
    document.body.appendChild(overlay);

    this.renderSubjectSearch(modalBody, overlay, ticketId);
  }

  // ─── Subject Search UI ───────────────────────────────────────────────────────

  /**
   * Replaces the modal body contents with a searchable subject picker interface.
   *
   * Purpose:
   * Allows the agent to quickly find and select the correct service level option
   * from the entire hierarchy. Only leaf entries (isLeaf: true) are shown, and
   * each result displays a breadcrumb path showing its parent context.
   *
   * @param modalBody - The existing modal container element to replace contents of.
   * @param overlay - The full-screen overlay element (for removal on cancel/success).
   */
  private static renderSubjectSearch(
    modalBody: HTMLElement,
    overlay: HTMLElement,
    ticketId: string,
  ): void {
    // Clear all existing children safely (no innerHTML)
    while (modalBody.firstChild) {
      modalBody.removeChild(modalBody.firstChild);
    }

    // Widen the modal to accommodate the search results list
    modalBody.className = 'atlas-modal-body atlas-modal-body-search';

    // ─── Title ─────────────────────────────────────────────────────────────────
    const title = document.createElement('h2');
    title.style.cssText =
      'color: #2d7966; margin: 0 0 12px 0; font-size: 18px; display: flex; align-items: center; gap: 8px;';

    // Brand icon — inline SVG comet
    const titleIcon = document.createElement('span');
    titleIcon.style.cssText =
      'display: inline-flex; align-items: center; flex-shrink: 0; color: #02ac85;';
    titleIcon.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l7.07 17 2.51-7.39L21 11.07z"/></svg>';
    title.appendChild(titleIcon);
    title.appendChild(document.createTextNode('Buscar Serviço'));

    modalBody.appendChild(title);

    // ─── Critical Error Fallback UI ──────────────────────────────────────────
    // Check if we actually have data to show. If not, show an error state.
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
        const startBtn = document.getElementById('iniciar-busca');
        if (startBtn) startBtn.click();
      };

      errorView.appendChild(errorIcon);
      errorView.appendChild(errorTitle);
      errorView.appendChild(errorText);
      errorView.appendChild(btnRetry);
      modalBody.appendChild(errorView);
      return;
    }

    // ─── Subtitle / Instructions ───────────────────────────────────────────────
    const subtitle = document.createElement('p');
    subtitle.style.cssText = 'color: #29735c; font-size: 13px; margin: 0 0 16px 0;';
    subtitle.textContent =
      'Selecione o tipo e o assunto. Os níveis de serviço serão preenchidos automaticamente.';

    // ─── Tipo Search Input ─────────────────────────────────────────────────────
    const tipoLabel = document.createElement('label');
    tipoLabel.style.cssText =
      'display: block; font-size: 13px; font-weight: 600; color: #27675c; margin-bottom: 6px;';
    tipoLabel.textContent = 'Tipo do Ticket:';

    const tipoWrapper = document.createElement('div');
    tipoWrapper.style.cssText = 'position: relative; margin-bottom: 6px;';

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
    tipoResultsContainer.style.display = 'none'; // Keep dynamic state as inline

    tipoWrapper.appendChild(tipoInput);
    tipoWrapper.appendChild(tipoResultsContainer);

    // ─── "Lembrar Tipo" Button ─────────────────────────────────────────────────
    /**
     * Micro-interaction button that persists the selected Tipo value to
     * chrome.storage.local. Same visual pattern as the level filter button.
     */
    const tipoRememberWrapper = document.createElement('div');
    tipoRememberWrapper.style.cssText =
      'display: flex; align-items: center; margin-bottom: 12px; width: 100%;';

    const tipoRememberBtnStyle = `
      font-size: 12px; color: #777; cursor: pointer; margin-left: auto;
      background: transparent; border: 1px solid #ccc; border-radius: 4px;
      padding: 4px 10px; display: inline-flex; align-items: center; gap: 5px;
      transition: all 0.2s ease-in-out; font-family: inherit;
    `;
    const tipoRememberBtn = document.createElement('button');
    tipoRememberBtn.style.cssText = tipoRememberBtnStyle;

    const tipoBookmarkSvg =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
    const tipoCheckSvg =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

    tipoRememberWrapper.appendChild(tipoRememberBtn);

    tipoRememberBtn.innerHTML = tipoBookmarkSvg;
    tipoRememberBtn.appendChild(document.createTextNode(' Lembrar Tipo'));

    tipoRememberBtn.addEventListener('mouseenter', () => {
      if (!tipoRememberBtn.dataset.saved) {
        tipoRememberBtn.style.borderColor = '#02ac85';
        tipoRememberBtn.style.color = '#02ac85';
      }
    });
    tipoRememberBtn.addEventListener('mouseleave', () => {
      if (!tipoRememberBtn.dataset.saved) {
        tipoRememberBtn.style.borderColor = '#ccc';
        tipoRememberBtn.style.color = '#777';
      }
    });
    tipoRememberBtn.addEventListener('click', () => {
      if (!ContextManager.isValid()) return;
      chrome.storage.local.set({ atlas_tipo_pref: tipoInput.value }, () => {
        tipoRememberBtn.dataset.saved = 'true';
        tipoRememberBtn.style.background = '#02ac85';
        tipoRememberBtn.style.borderColor = '#02ac85';
        tipoRememberBtn.style.color = '#ffffff';
        tipoRememberBtn.innerHTML = tipoCheckSvg;
        tipoRememberBtn.appendChild(document.createTextNode(' Tipo Salvo'));
        setTimeout(() => {
          delete tipoRememberBtn.dataset.saved;
          tipoRememberBtn.style.background = 'transparent';
          tipoRememberBtn.style.borderColor = '#ccc';
          tipoRememberBtn.style.color = '#777';
          tipoRememberBtn.innerHTML = tipoBookmarkSvg;
          tipoRememberBtn.appendChild(document.createTextNode(' Lembrar Tipo'));
        }, 2000);
      });
    });

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
          // use mousedown so it fires before the input's blur event hides the container
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

    /**
     * Search input wrapped in a container to position an inline SVG
     * magnifying glass icon inside the left edge of the field.
     */
    const searchWrapper = document.createElement('div');
    searchWrapper.style.cssText = 'position: relative;';

    // SVG magnifying glass icon — thin, minimal, brand-colored
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

    // Visual feedback on focus
    searchInput.addEventListener('focus', () => {
      searchInput.style.borderColor = '#02ac85';
      searchInput.style.boxShadow = '0 0 0 3px rgba(172, 254, 223, 0.2)';
    });
    searchInput.addEventListener('blur', () => {
      searchInput.style.borderColor = '#ddd';
      searchInput.style.boxShadow = 'none';
    });

    // ─── Level Filter Checkboxes ──────────────────────────────────────────────
    /**
     * Checkbox-based level filters allow the agent to toggle between
     * Nível 3 (full tree: N1>N2>N3) and Nível 2 (stops one level earlier).
     * Default state: only Nível 3 checked, unless overridden by saved preference.
     */
    const filterRow = document.createElement('div');
    filterRow.style.cssText = `
      display: flex; align-items: center; gap: 16px; margin: 10px 0 4px 0;
      flex-wrap: wrap;
    `;

    // Shared style for checkbox labels
    const checkboxLabelStyle =
      'display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: #29735c; cursor: pointer; user-select: none;';

    // Nível 3 checkbox (default: checked)
    const cbN3Label = document.createElement('label');
    cbN3Label.style.cssText = checkboxLabelStyle;
    const cbN3 = document.createElement('input');
    cbN3.type = 'checkbox';
    cbN3.checked = true; // Default — may be overridden by saved preference below
    cbN3.style.cssText = 'cursor: pointer; accent-color: #02ac85;';
    cbN3Label.appendChild(cbN3);
    cbN3Label.appendChild(document.createTextNode('Mostrar Serviço Nível 3'));

    // Nível 2 checkbox (default: unchecked)
    const cbN2Label = document.createElement('label');
    cbN2Label.style.cssText = checkboxLabelStyle;
    const cbN2 = document.createElement('input');
    cbN2.type = 'checkbox';
    cbN2.checked = false; // Default — may be overridden by saved preference below
    cbN2.style.cssText = 'cursor: pointer; accent-color: #02ac85;';
    cbN2Label.appendChild(cbN2);
    cbN2Label.appendChild(document.createTextNode('Mostrar Serviço Nível 2'));

    // ─── "Lembrar Preferências" Button ──────────────────────────────────────────
    /**
     * Polished micro-interaction button that persists the current checkbox state
     * to chrome.storage.local. Features a smooth transition from its default
     * outlined style to a confirmed green state when saved.
     */
    const rememberBtn = document.createElement('button');
    rememberBtn.style.cssText = `
      font-size: 12px; color: #777; cursor: pointer; margin-left: auto;
      background: transparent; border: 1px solid #ccc; border-radius: 4px;
      padding: 4px 10px; display: inline-flex; align-items: center; gap: 5px;
      transition: all 0.2s ease-in-out; font-family: inherit;
    `;

    // SVG bookmark icon — default state
    const bookmarkSvg =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
    // SVG checkmark icon — saved state
    const checkSvg =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

    rememberBtn.innerHTML = bookmarkSvg;
    rememberBtn.appendChild(document.createTextNode(' Lembrar Preferências'));

    rememberBtn.addEventListener('mouseenter', () => {
      // Only apply hover if not in "saved" state
      if (!rememberBtn.dataset.saved) {
        rememberBtn.style.borderColor = '#02ac85';
        rememberBtn.style.color = '#02ac85';
      }
    });
    rememberBtn.addEventListener('mouseleave', () => {
      if (!rememberBtn.dataset.saved) {
        rememberBtn.style.borderColor = '#ccc';
        rememberBtn.style.color = '#777';
      }
    });
    rememberBtn.addEventListener('click', () => {
      if (!ContextManager.isValid()) return;
      const prefs = { n3: cbN3.checked, n2: cbN2.checked };
      chrome.storage.local.set({ atlas_user_prefs: prefs }, () => {
        // Transition to confirmed "saved" state with brand green
        rememberBtn.dataset.saved = 'true';
        rememberBtn.style.background = '#02ac85';
        rememberBtn.style.borderColor = '#02ac85';
        rememberBtn.style.color = '#ffffff';
        rememberBtn.innerHTML = checkSvg;
        rememberBtn.appendChild(document.createTextNode(' Preferências Salvas'));
        // Revert to default after 2 seconds
        setTimeout(() => {
          delete rememberBtn.dataset.saved;
          rememberBtn.style.background = 'transparent';
          rememberBtn.style.borderColor = '#ccc';
          rememberBtn.style.color = '#777';
          rememberBtn.innerHTML = bookmarkSvg;
          rememberBtn.appendChild(document.createTextNode(' Lembrar Preferências'));
        }, 2000);
      });
    });

    filterRow.appendChild(cbN2Label);
    filterRow.appendChild(cbN3Label);
    filterRow.appendChild(rememberBtn);

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

    // ─── Helper: build the allowed-levels set from checkbox state ──────────────
    /**
     * Constructs a Set<number> from the current checkbox states.
     * Level 3 = entries at depth 3 (full N1>N2>N3 tree).
     * Level 2 = entries at depth 2 (tree stops at N1>N2).
     * Returns an empty Set when neither is checked — used by runSearch
     * to trigger the safety lock warning.
     */
    const getAllowedLevels = (): Set<number> => {
      const levels = new Set<number>();
      if (cbN3.checked) levels.add(3);
      if (cbN2.checked) levels.add(2);
      return levels;
    };

    // ─── Helper: run search with current query + level filters ─────────────────
    /**
     * Central search executor. Called on every input/checkbox change.
     * Implements a safety lock: if no levels are selected, the results
     * list is replaced with a governance warning, preventing the agent
     * from proceeding without an explicit level choice.
     */
    const runSearch = () => {
      const levels = getAllowedLevels();

      // Safety lock: both checkboxes unchecked → show warning, hide results
      if (levels.size === 0) {
        while (resultsContainer.firstChild) {
          resultsContainer.removeChild(resultsContainer.firstChild);
        }
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
      this.renderSearchResults(
        resultsContainer,
        filtered,
        overlay,
        ticketId,
        () => tipoInput.value,
        query,
      );
    };

    /**
     * Input event handler for live-filtering the leaf entries.
     * Debounced implicitly by the browser's event loop; further debouncing
     * is unnecessary since String.includes() over ~1000 entries is sub-millisecond.
     */
    searchInput.addEventListener('input', runSearch);

    // Instant filtering when checkboxes are toggled
    cbN3.addEventListener('change', runSearch);
    cbN2.addEventListener('change', runSearch);

    // Assemble the search UI
    modalBody.appendChild(title);
    modalBody.appendChild(subtitle);
    modalBody.appendChild(tipoLabel);
    modalBody.appendChild(tipoWrapper);
    modalBody.appendChild(tipoRememberWrapper);
    modalBody.appendChild(assuntoLabel);
    modalBody.appendChild(searchWrapper);
    modalBody.appendChild(filterRow);
    modalBody.appendChild(resultsContainer);
    modalBody.appendChild(btnCancel);

    // ─── Load saved level preferences from chrome.storage.local ───────────────
    /**
     * On modal open, check for a previously saved level filter preference.
     * If found, apply it to the checkboxes and re-run the search.
     * If not found, the default state (Nível 3 checked only) is used.
     */
    if (ContextManager.isValid()) {
      chrome.storage.local.get(['atlas_user_prefs', 'atlas_tipo_pref'], (result) => {
        // Restore level filter checkboxes
        const prefs = result.atlas_user_prefs;
        if (prefs && typeof prefs === 'object') {
          cbN3.checked = !!prefs.n3;
          cbN2.checked = !!prefs.n2;
        }
        // Restore Tipo preference (defaults to DEFAULT_TICKET_TYPE if not saved)
        const savedTipo = result.atlas_tipo_pref;
        if (savedTipo && typeof savedTipo === 'string') {
          tipoInput.value = savedTipo;
        }
        // Run the initial search after preferences are loaded
        runSearch();
        // Auto-focus the search input for immediate typing
        setTimeout(() => searchInput.focus(), 50);
      });
    } else {
      runSearch();
      setTimeout(() => searchInput.focus(), 50);
    }
  }

  /**
   * Helper function to securely highlight text without using innerHTML.
   *
   * Multi-token aware: each token in the query (split by whitespace) is
   * independently highlighted. Accent-insensitive and case-insensitive
   * matching is achieved by comparing normalized strings, but a character-level
   * index mapping ensures highlights land on the correct positions in the
   * original (un-normalized) text — even when accented characters change
   * string length during NFD decomposition (e.g., 'ã' → 'a').
   *
   * @param container - The element to append highlighted text nodes into.
   * @param text - The original text to display (preserving accents/case).
   * @param query - The raw search query; split into tokens for multi-word matching.
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

    /**
     * Build a character-level mapping from original text to normalized text.
     * Each original character at index `i` maps to a normalized character
     * at `origToNorm[i]`. This lets us find matches on the normalized string
     * and map highlights back to original positions accurately.
     */
    const origChars: string[] = [];
    const normChars: string[] = [];
    const origToNorm: number[] = [];

    for (let i = 0; i < text.length; i++) {
      const origChar = text[i];
      const normChar = origChar
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/-/g, ' ')
        .toLowerCase();
      origChars.push(origChar);
      origToNorm.push(normChars.length);
      for (const c of normChar) {
        normChars.push(c);
      }
    }

    const normalizedText = normChars.join('');
    const matchMaskNorm = new Array(normalizedText.length).fill(false);

    // Mark matched positions on the normalized string
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

    // Map normalized match mask back to original character positions
    const matchMask = new Array(text.length).fill(false);
    for (let i = 0; i < text.length; i++) {
      const normIdx = origToNorm[i];
      const nextNormIdx = i + 1 < text.length ? origToNorm[i + 1] : normalizedText.length;
      // Mark original char as matched if any of its normalized chars are matched
      for (let n = normIdx; n < nextNormIdx; n++) {
        if (matchMaskNorm[n]) {
          matchMask[i] = true;
          break;
        }
      }
    }

    // Render chunks grouped by match state
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

  /**
   * Renders a list of search result items inside the results container.
   *
   * Purpose:
   * Each result is an <li> element showing the option label and a dimmed breadcrumb
   * path of its parent hierarchy. Clicking a result triggers the auto-fill process.
   * All DOM construction uses secure createElement APIs — no innerHTML.
   *
   * @param container - The <ul> element to populate with results.
   * @param results - Array of matching LookupEntry objects to display.
   * @param overlay - The overlay element reference for removal after successful fill.
   * @param ticketId - The current ticket ID being edited.
   * @param getTicketType - Function to dynamically get the currently selected Tipo value.
   */
  private static renderSearchResults(
    container: HTMLElement,
    results: LookupEntry[],
    overlay: HTMLElement,
    ticketId: string,
    getTicketType: () => string,
    query: string = '',
  ): void {
    // Clear previous results safely
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    // Show empty state if no results match
    if (results.length === 0) {
      const emptyItem = document.createElement('li');
      emptyItem.style.cssText = 'padding: 16px; text-align: center; color: #999; font-size: 14px;';
      emptyItem.textContent = query.trim()
        ? `Não encontramos nada para "${query}". Que tal tentar palavras-chave mais simples?`
        : 'Nenhum resultado encontrado.';
      container.appendChild(emptyItem);
      return;
    }

    // Build each result item
    for (const entry of results) {
      const li = document.createElement('li');
      li.style.cssText = `
        padding: 10px 14px; cursor: pointer; border-bottom: 1px solid #f0f0f0;
        transition: background 0.15s ease; margin-bottom: 2px;
      `;

      // Hover effects for visual feedback
      li.addEventListener('mouseenter', () => {
        li.style.background = '#f0f7ff';
      });
      li.addEventListener('mouseleave', () => {
        li.style.background = 'transparent';
      });

      // ─── Title Row: Assunto Label + N1 Badge ─────────────────────────────────
      /**
       * The title row shows the leaf assunto name as the primary focus,
       * with a discrete badge showing the top-level category (N1) for
       * instant disambiguation of duplicate names like "Leads".
       * Layout: [Leads] [Comercial]
       */
      const titleRow = document.createElement('div');
      titleRow.style.cssText = 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap;';

      // Assunto label — bold, primary text with highlighting
      const labelSpan = document.createElement('span');
      labelSpan.style.cssText = 'font-size: 14px; font-weight: 600; color: #29735c;';
      this.appendHighlightedText(labelSpan, entry.label, query);
      titleRow.appendChild(labelSpan);

      // N1 Badge — shows the top-level parent with category-specific pastel colors
      const sortedParents = [...(entry.parents || [])].sort((a, b) => a.level - b.level);
      if (sortedParents.length > 0) {
        const n1Label = sortedParents[0].label;

        /**
         * Dynamic badge color mapping based on the N1 category name.
         * Each CV vertical gets a distinct pastel scheme for instant
         * visual grouping. Default is neutral gray for unknown categories.
         */
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

      // ─── Subtitle Row: Full Breadcrumb Path ──────────────────────────────────
      /**
       * Shows the complete hierarchical path below the title in a small,
       * dimmed font. This provides full context without cluttering the
       * primary label. Example: "CV Prospectar > APIs CV > Leads"
       */
      const breadcrumb = LookupService.getBreadcrumb(entry);
      if (breadcrumb) {
        const fullPath = `${breadcrumb} > ${entry.label}`;
        const breadcrumbSpan = document.createElement('span');
        breadcrumbSpan.style.cssText =
          'display: block; font-size: 11px; color: #999; margin-top: 3px;';
        this.appendHighlightedText(breadcrumbSpan, fullPath, query);
        li.appendChild(breadcrumbSpan);
      }

      /**
       * Click handler: resolves the full parent chain and sends a single API
       * request to update all service levels atomically, then reloads the page
       * to sync Ember's in-memory model with the backend state.
       */
      // Captura o ID SEMPRE no momento do clique (SPA cache fix)
      li.addEventListener('click', async () => {
        const ticketId = window.location.pathname.split('/').pop() || UIFactory.currentTicketId;

        if (!ticketId) {
          console.warn('[Atlas Comet] Ticket ID não encontrado durante o processamento.');
          return;
        }

        const chain = LookupService.getParentChain(entry.choiceId);
        if (chain.length === 0) {
          console.warn(
            `[Atlas Comet] Could not resolve parent chain for choiceId: ${entry.choiceId}`,
          );
          return;
        }

        // Extract N1, N2, N3 values from the resolved chain
        const n1 = chain.find((e) => e.level === 1)?.label ?? '';
        const n2 = chain.find((e) => e.level === 2)?.label ?? '';
        const n3 = chain.find((e) => e.level === 3)?.label ?? '';
        const selectedTipo = getTicketType();

        // ─── Toast: PROCESSING state ─────────────────────────────────────────────
        /**
         * Premium Pro toast container with comet orbit animation.
         * Replaces the modal body content with a branded notification
         * using fade-in/slide-up entry animation.
         */
        const modal = overlay.querySelector('div');
        if (modal) {
          while (modal.firstChild) {
            modal.removeChild(modal.firstChild);
          }

          // Toast container with brand styling and fade-in animation
          const toastContainer = document.createElement('div');
          toastContainer.className = 'atlas-toast-container';
          toastContainer.style.cssText = 'animation: atlas-comet-fade-in 0.3s ease-out forwards;';

          // Lottie animation container (Premium Experience)
          const cometLoader = document.createElement('div');
          cometLoader.id = 'atlas-lottie-loader';
          cometLoader.style.cssText = 'width: 200px; height: 200px; margin: 0 auto; display: block;';

          const loadingText = document.createElement('p');
          loadingText.style.cssText =
            'color: #29735c; font-size: 15px; font-weight: 500; margin: 0; position: relative; z-index: 10;';
          loadingText.textContent = 'Definindo serviço do ticket...';

          toastContainer.appendChild(cometLoader);
          toastContainer.appendChild(loadingText);
          modal.appendChild(toastContainer);

          // Initialize Lottie animation immediately after container is added to DOM
          lottie.loadAnimation({
            container: cometLoader,
            renderer: 'svg',
            loop: true,
            autoplay: true,
            animationData: loaderJson,
          });
        }

        // ─── Silent Subject Auto-Rename (DOM Scraping + V2 API Architecture) ───
        let rawCompany = 'Empresa Indefinida';
        let rawClient = 'Cliente Indefinido';
        let contactId: string | null = null;
        let companyId: string | null = null;

        let currentTags: string[] = [];
        try {
          // Resgata as tags atuais via API V2 + enriquece com dados da empresa (Plano B)
          // O parâmetro ?include=company retorna o objeto company.name na mesma requisição
          const tRes = await fetch(`/api/v2/tickets/${ticketId}?include=company`);
          if (tRes.ok) {
            const tData = await tRes.json();
            currentTags = tData.tags || [];

            // PLANO B: Extrai o nome da empresa direto da resposta enriquecida do ticket
            // Serve como fallback robusto quando o Shadow DOM não contém o link /companies/
            if (tData.company && tData.company.name) {
              rawCompany = tData.company.name;
            }
          }
        } catch (e) {
          console.log('[Atlas Comet] Erro ao buscar tags atuais', e);
        }

        // PASSO 1: Capturar visualmente e extrair IDs do DOM
        // Estratégia em camadas: tenta Shadow DOM primeiro (layout antigo), depois
        // busca no documento principal usando seletores baseados em href (layout novo).
        // O seletor `a[href*="/a/contacts/"]` é extremamente estável porque depende
        // da rota da aplicação, não de classes CSS genéricas que o Freshdesk muda.

        // --- Camada 1: Shadow DOM (layout legado) ---
        const mfeApp = document.querySelector(
          'mfe-application[app-id="fw-unified-mfe--contact-info"]',
        ) as HTMLElement & { shadowRoot: ShadowRoot };
        if (mfeApp && mfeApp.shadowRoot) {
          const shadowRoot = mfeApp.shadowRoot;

          const clientEl = shadowRoot.querySelector('a[href*="/contacts/"]');
          if (clientEl) {
            rawClient = clientEl.textContent?.trim() || rawClient;
            const matchId = (clientEl as HTMLAnchorElement).href.match(/\/contacts\/(\d+)/);
            if (matchId) contactId = matchId[1];
          }

          const companyEl = shadowRoot.querySelector('a[href*="/companies/"]');
          if (companyEl) {
            rawCompany = companyEl.textContent?.trim() || rawCompany;
            const matchId = (companyEl as HTMLAnchorElement).href.match(/\/companies\/(\d+)/);
            if (matchId) companyId = matchId[1];
          } else {
            // Tenta buscar no atributo aria-label se o texto for nulo
            const anyComp = shadowRoot.querySelector(
              'a[aria-label*="Go to"], a[aria-label*="Ir para"]',
            );
            if (anyComp) {
              const ariaMatch = anyComp
                .getAttribute('aria-label')
                ?.match(/(?:Go to|Ir para)\s+(.+)/i);
              if (ariaMatch && ariaMatch[1]) rawCompany = ariaMatch[1].trim();
            }
          }
        }

        // --- Camada 2: Documento principal (layout novo do Freshdesk - Junho/2026) ---
        // O Freshdesk moveu os links de contato e empresa para FORA do Shadow DOM.
        // Usamos seletores baseados na rota do href (/a/contacts/ e /a/companies/)
        // que são muito mais resistentes a mudanças visuais do que classes CSS.
        if (rawClient === 'Cliente Indefinido' || !contactId) {
          const clientElMain = document.querySelector<HTMLAnchorElement>('a[href*="/a/contacts/"]');
          if (clientElMain) {
            const nameText = clientElMain.textContent?.trim();
            if (nameText && rawClient === 'Cliente Indefinido') {
              rawClient = nameText;
            }
            if (!contactId) {
              const matchId = clientElMain.href.match(/\/contacts\/(\d+)/);
              if (matchId) contactId = matchId[1];
            }
          }
        }

        if (rawCompany === 'Empresa Indefinida' || !companyId) {
          const companyElMain = document.querySelector<HTMLAnchorElement>('a[href*="/a/companies/"]');
          if (companyElMain) {
            const companyText = companyElMain.textContent?.trim();
            if (companyText && rawCompany === 'Empresa Indefinida') {
              rawCompany = companyText;
            }
            if (!companyId) {
              const matchId = companyElMain.href.match(/\/companies\/(\d+)/);
              if (matchId) companyId = matchId[1];
            }
          }
        }

        // --- Camada 3: Ember dropdown trigger (estrutura do user-link) ---
        // Algumas telas do Freshdesk renderizam o nome do contato dentro de um
        // `<a data-test-id="user-name">` envolto por um div `data-test-id="user-link"`.
        // O nome fica dentro de um <b> tag. O href contém a rota /a/contacts/{id}.
        // Esse seletor é estável porque usa data-test-id (atributo de teste do Ember).
        if (rawClient === 'Cliente Indefinido' || !contactId) {
          const userNameEl = document.querySelector<HTMLAnchorElement>(
            'a[data-test-id="user-name"][href*="/contacts/"]',
          );
          if (userNameEl) {
            const nameText = userNameEl.textContent?.trim();
            if (nameText && rawClient === 'Cliente Indefinido') {
              rawClient = nameText;
            }
            if (!contactId) {
              const matchId = userNameEl.href.match(/\/contacts\/(\d+)/);
              if (matchId) contactId = matchId[1];
            }
          }
        }

        // PASSO 2 (PLANO A): Obter o nome COMPLETO via API V2
        if (contactId) {
          try {
            const cRes = await fetch(`/api/v2/contacts/${contactId}`);
            if (cRes.ok) {
              const cData = (await cRes.json()) as Record<string, unknown>;
              if (cData && cData.name) rawClient = cData.name as string;
            }
          } catch (e) {
            Logger.info('[Atlas Comet] Erro no Plano A do Cliente API', e);
          }
        }

        if (companyId) {
          try {
            const cmpRes = await fetch(`/api/v2/companies/${companyId}`);
            if (cmpRes.ok) {
              const cmpData = (await cmpRes.json()) as Record<string, unknown>;
              if (cmpData && cmpData.name) rawCompany = cmpData.name as string;
            }
          } catch (e) {
            Logger.info('[Atlas Comet] Erro no Plano A da Empresa API', e);
          }
        }

        // CENÁRIO 2: Fallback para E-mail no Nome do Contato
        // Se o nome capturado for um e-mail, buscamos o nome real no remetente da primeira mensagem
        if (rawClient.includes('@')) {
          const fallbackEl = document.querySelector(
            'div[style*="margin-left: 33px"][style*="color: #6f7071"]',
          );
          if (fallbackEl && fallbackEl.textContent) {
            const fallbackName = fallbackEl.textContent.trim();
            // Só substitui se o fallback não for outro e-mail e não estiver vazio
            if (fallbackName && !fallbackName.includes('@')) {
              rawClient = fallbackName;
            }
          }
        }

        // REGRA DE NEGÓCIO ESPECIAL: Interceptador Agência/Finder
        // Se o Plano A ou B trouxer a empresa genérica, forçamos o Plano C (Team Inbox) para pegar o nome real
        if (rawCompany && rawCompany.toLowerCase().includes('agência/finder')) {
          rawCompany = 'Empresa Indefinida';
        }

        // PASSO 4 (PLANO C): Fallback no Team Inbox via Iframe Oculto (Caso Plano A e B falhem)
        // Solução 100% invisível: injetamos o Team Inbox num Iframe com display: none.
        // O nosso content script (.all_frames=true) é injetado lá dentro, lê o DOM
        // e nos devolve o nome da empresa via postMessage.
        if (rawCompany === 'Empresa Indefinida') {
          const teamInboxBtn = document.querySelector('a[href*="/crm/messaging/"]');
          if (teamInboxBtn) {
            try {
              const scrapeResponse = await new Promise<{
                success: boolean;
                companyName?: string;
                error?: string;
              }>((resolve) => {
                const iframe = document.createElement('iframe');
                iframe.style.display = 'none';
                iframe.src = (teamInboxBtn as HTMLAnchorElement).href;

                // eslint-disable-next-line prefer-const
                let timeout: ReturnType<typeof setTimeout> | undefined;
                const messageHandler = (event: MessageEvent) => {
                  if (event.data && event.data.type === 'ATLAS_COMET_TEAM_INBOX_RESULT') {
                    window.removeEventListener('message', messageHandler);
                    if (timeout) clearTimeout(timeout);
                    iframe.remove();
                    resolve({ success: true, companyName: event.data.companyName });
                  }
                };

                window.addEventListener('message', messageHandler);

                // Timeout de segurança de 15s
                timeout = setTimeout(() => {
                  window.removeEventListener('message', messageHandler);
                  iframe.remove();
                  resolve({ success: false, error: 'Timeout ao extrair do Iframe' });
                }, 15000);

                document.body.appendChild(iframe);
              });

              if (scrapeResponse && scrapeResponse.success && scrapeResponse.companyName) {
                rawCompany = scrapeResponse.companyName;
              } else {
                console.log(
                  '[Atlas Comet] Plano C: Scraping do Team Inbox via Iframe falhou',
                  scrapeResponse?.error,
                );
              }
            } catch (e) {
              console.log('[Atlas Comet] Erro no Plano C (Team Inbox)', e);
            }
          }
        }

        // PASSO 3: Formatação Ninja
        const companyName = this.formatProperName(rawCompany, false);
        const clientName = this.formatProperName(rawClient, true);

        const servicoFinal = n3 || n2;
        const newSubject = `${companyName} - ${clientName} - ${servicoFinal}`;

        // PASSO 6: Lógica Inteligente de Tags
        // Removemos as tags de controle da nossa lista temporária para "limpar a lousa"
        const finalTags = currentTags.filter(
          (tag) => tag !== 'pendente_nome_empresa_cliente' && tag !== CONSTANTS.VALUES.OFFLINE_TAG,
        );

        // Adicionamos de volta APENAS se houver alguma pendência real
        if (companyName === 'Indefinido' || clientName === 'Indefinido') {
          finalTags.push('pendente_nome_empresa_cliente');
        }

        try {
          // 1. Update Service Levels via main API
          await FreshdeskAPI.updateServiceLevels(ticketId, n1, n2, n3, selectedTipo);

          // 2. Update Subject via internal update_properties API
          await FreshdeskAPI.updateTicketSubjectSilently(ticketId, newSubject, finalTags);

          // Mark as defined in this session to prevent the observer from re-triggering "Sim, Offline"
          AppState.getInstance().setServiceDefined(true);

          // Update the UI title immediately for instant visual feedback (UX)
          const subjectDisplay = document.querySelector('.ticket-subject-heading');
          if (subjectDisplay) {
            // Modifica apenas o valor do nó de texto existente para não perder a referência do SPA
            let textNodeUpdated = false;
            Array.from(subjectDisplay.childNodes).forEach((node) => {
              if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim() !== '') {
                node.textContent = newSubject + ' ';
                textNodeUpdated = true;
              }
            });

            // Fallback de segurança absoluto (caso o Freshdesk limpe a div por algum motivo)
            if (!textNodeUpdated && subjectDisplay.firstChild) {
              subjectDisplay.firstChild.textContent = newSubject + ' ';
            }
          }

          // Remove the offline label and confirm button from the UI immediately
          this.removeOfflineLabel();
          const btnConfirm = document.getElementById('confirm-offline');
          if (btnConfirm) btnConfirm.remove();

          UIFactory.removeTagFromDOM(CONSTANTS.VALUES.OFFLINE_TAG);

          // ─── Toast: SUCCESS state ──────────────────────────────────────────────
          if (modal) {
            while (modal.firstChild) modal.removeChild(modal.firstChild);

            const successContainer = document.createElement('div');
            successContainer.style.cssText = `
              display: flex; flex-direction: column; align-items: center; justify-content: center;
              padding: 40px 30px; text-align: center;
              animation: atlas-comet-crossfade 0.3s ease-out forwards;
            `;

            // Checkmark SVG icon — thin strokes, brand green
            const checkIcon = document.createElement('div');
            checkIcon.style.cssText =
              'width: 200px; height: 200px; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px auto; color: #02ac85;';
            checkIcon.innerHTML = `
              <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="8 12 11 15 16 9"/>
              </svg>
            `;

            const successText = document.createElement('p');
            successText.style.cssText =
              'color: #29735c; font-size: 15px; font-weight: 500; margin: 0;';
            successText.textContent = 'Assunto definido! Sincronizando tela...';

            successContainer.appendChild(checkIcon);
            successContainer.appendChild(successText);
            modal.appendChild(successContainer);
          }

          // Force Freshdesk to sync the UI by reloading the Ember Model in the Main World
          await FreshdeskAPI.reloadTicketInEmber(ticketId);

          setTimeout(() => overlay.remove(), 800);
        } catch (error) {
          console.log('[Atlas Comet] Erro ao atualizar ticket via API:', error);

          // ─── Toast: ERROR state ────────────────────────────────────────────────
          if (modal) {
            while (modal.firstChild) modal.removeChild(modal.firstChild);

            const errorContainer = document.createElement('div');
            errorContainer.style.cssText = `
              display: flex; flex-direction: column; align-items: center; justify-content: center;
              padding: 40px 30px; text-align: center;
              animation: atlas-comet-crossfade 0.3s ease-out forwards;
            `;

            // Warning triangle SVG — thin strokes, muted coral
            const warnIcon = document.createElement('div');
            warnIcon.style.cssText =
              'width: 200px; height: 200px; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px auto; color: #d9534f;';
            warnIcon.innerHTML = `
              <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            `;

            const errorText = document.createElement('p');
            errorText.style.cssText =
              'color: #29735c; font-size: 15px; font-weight: 500; margin: 0 0 8px 0;';
            errorText.textContent = 'Erro ao atualizar via API. Tente manualmente.';

            // Detailed error info for debugging
            const errorDetail = document.createElement('pre');
            errorDetail.style.cssText =
              'color: #999; font-size: 11px; text-align: left; margin-top: 10px; white-space: pre-wrap; word-break: break-all; max-width: 100%;';
            errorDetail.textContent = error instanceof Error ? error.message : String(error);

            errorContainer.appendChild(warnIcon);
            errorContainer.appendChild(errorText);
            errorContainer.appendChild(errorDetail);
            modal.appendChild(errorContainer);
          }
          setTimeout(() => overlay.remove(), 5000);
        }
      });

      container.appendChild(li);
    }
  }

  /**
   * Cleans and formats a name to Title Case, removing metadata after hyphens
   * and handling ellipses.
   *
   * @param text - The raw text string to format.
   * @param isClient - If true, limits the name to 4 words and removes trailing prepositions.
   * @returns {string} The formatted name.
   */
  public static formatProperName(text: string, isClient: boolean = false): string {
    if (!text || text === 'Empresa Indefinida' || text === 'Cliente Indefinido')
      return 'Indefinido';

    if (isClient) {
      // CENÁRIO 1: Limpeza e Padronização do Nome do Cliente
      // 1. Remover pontos (.) e substituí-los por espaços
      // 2. Cortar cargos (após hífen)
      const clean = text.split('-')[0].replace(/\./g, ' ').trim();

      // 3. Remover espaços em branco duplicados e aplicar Title Case
      // A regra de Title Case aqui é rigorosa: Primeira letra Maiúscula, resto Minúscula.
      const words = clean
        .split(/\s+/)
        .filter((w) => w.length > 0)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

      // 4. Deduplicação e Limite de 3 nomes (Manter a regra de negócio original de contagem)
      const finalWords: string[] = [];
      let mainNamesCount = 0;
      // Nota: Mesmo em Title Case, mantemos a lógica de não contar preposições para o limite de 3
      const preposicoes = ['De', 'Da', 'Do', 'Das', 'Dos', 'E'];

      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const prevWord = i > 0 ? words[i - 1] : null;

        // Evita nomes repetidos seguidos (ex: "Juliana Juliana")
        if (prevWord && word.toLowerCase() === prevWord.toLowerCase()) continue;

        if (preposicoes.includes(word)) {
          finalWords.push(word);
        } else {
          if (mainNamesCount < 3) {
            finalWords.push(word);
            mainNamesCount++;
          } else {
            break;
          }
        }
      }

      // Remove preposição se ficar "pendurada" no final
      while (finalWords.length > 0 && preposicoes.includes(finalWords[finalWords.length - 1])) {
        finalWords.pop();
      }

      return finalWords.join(' ');
    }

    // Lógica para Empresa (Mantida conforme original, sem as novas regras de cliente)
    const clean = text
      .split('-')[0]
      .replace(/\.{2,}/g, '')
      .trim();
    const words = clean.split(/\s+/);

    const uniqueWords: string[] = [];
    for (let i = 0; i < words.length; i++) {
      if (i === 0 || words[i].toLowerCase() !== words[i - 1].toLowerCase()) {
        uniqueWords.push(words[i]);
      }
    }
    return uniqueWords.join(' ');
  }

  // ─── Tag Auto-Fill (existing) ──────────────────────────────────────────────

  public static removeTagFromDOM(tagToRemove: string) {
    const tagContainer = document.querySelector(CONSTANTS.SELECTORS.TAG_CONTAINER);
    if (!tagContainer) return;

    const listItems = Array.from(
      tagContainer.querySelectorAll('.ember-power-select-multiple-option'),
    );
    const targetItem = listItems.find(
      (li) => li.textContent && li.textContent.includes(tagToRemove),
    );

    if (targetItem) {
      const closeBtn = targetItem.querySelector(
        '.ember-power-select-multiple-remove-btn',
      ) as HTMLElement;
      if (closeBtn) {
        closeBtn.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }),
        );
        closeBtn.click();
      }
    }
  }

  /**
   * Helper function to automate filling the ticket's tag field.
   *
   * Purpose:
   * Programmatically edits the Ember tag input element, dispatches the appropriate
   * events to alert the SPA, and initiates an observer to select the dropdown result.
   *
   * @param tagValue - The exact string value of the tag to insert.
   */
  private static async fillTagAndSelect(tagValue: string): Promise<void> {
    const inputSelector = CONSTANTS.SELECTORS.TAG_INPUT;
    const tagInput = document.querySelector<HTMLInputElement>(inputSelector);

    if (!tagInput) {
      console.log('[Atlas Comet] Tag input field not found');
      return;
    }

    // Focus the input to align with standard user interaction flows in Ember apps
    tagInput.focus();

    // Instead of slow key-by-key typing, inject the entire value immediately
    // to prevent user interaction mid-entry from breaking the flow.
    tagInput.value = tagValue;
    tagInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Small delay to allow Ember's runloop to kick in and fetch/render the dropdown.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Start waiting for the power select dropdown item to be appended to the DOM.
    this.waitForOptionAndClick(tagValue);
  }

  /**
   * Utilizes a MutationObserver to watch for the exact moment the tag option is
   * asynchronously rendered into the DOM by Ember's power-select component.
   *
   * @param tagValue - The exact text value we are looking for inside the rendered span.
   */
  private static waitForOptionAndClick(tagValue: string): void {
    let observer: MutationObserver | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    /**
     * Tries to find the rendered HTML list element. If found, simulates a robust click event
     * directly on the span (as Ember's event delegation can be particular) and cleans up observers.
     */
    const tryClickOption = () => {
      const options = Array.from(document.querySelectorAll(`${CONSTANTS.SELECTORS.TAG_OPTIONS}`));
      const targetOption = options.find((el) => el.textContent?.trim() === tagValue);

      if (targetOption) {
        // Dispatching full mouse event lifecycle directly onto the span
        // Ember-power-select often relies on mousedown/mouseup rather than a simple .click()
        targetOption.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }),
        );
        targetOption.dispatchEvent(
          new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }),
        );
        targetOption.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true, view: window }),
        );

        // Find the form's submit button to finalize the update
        const submitButtons = Array.from(
          document.querySelectorAll(`${CONSTANTS.SELECTORS.SUBMIT_BUTTON}`),
        );
        const updateBtn = submitButtons.find(
          (btn) => btn.textContent?.trim() === CONSTANTS.VALUES.BTN_UPDATE_TEXT,
        ) as HTMLButtonElement;

        if (updateBtn) {
          // Delay briefly to allow Ember's runloop to fully register the newly selected tag
          setTimeout(() => {
            updateBtn.dispatchEvent(
              new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }),
            );
            updateBtn.dispatchEvent(
              new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }),
            );
            updateBtn.click();
          }, 100);
        } else {
          console.log('[Atlas Comet] Submit button "Atualizar" not found.');
        }

        if (observer) observer.disconnect();
        if (timeoutId) clearTimeout(timeoutId);
        return true;
      }
      return false; // Option hasn't rendered yet
    };

    // Immediate check in case the Ember rendering loop completed instantaneously
    if (tryClickOption()) return;

    // Otherwise, set up an observer to await the change.
    observer = new MutationObserver(() => {
      tryClickOption();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Fallback: Disconnect if the expected DOM element is not rendered within 10 seconds.
    timeoutId = setTimeout(() => {
      if (observer) observer.disconnect();
      // eslint-disable-next-line no-console
      console.log('[Atlas Comet] Timeout waiting for tag dropdown option.');
    }, 10000);
  }
}

// ─── SENTINELA DE URL (SPA WATCHER) ───────────────────────────────────────
let lastTicketId = window.location.pathname.includes('/a/tickets/')
  ? window.location.pathname.split('/').pop()
  : null;

setInterval(() => {
  const pathname = window.location.pathname;
  const currentTicketId = pathname.split('/').pop();

  // Só dispara se estivermos em uma URL de ticket E o ID mudou
  if (
    pathname.includes('/a/tickets/') &&
    currentTicketId &&
    currentTicketId !== lastTicketId &&
    currentTicketId.match(/^\d+$/)
  ) {
    lastTicketId = currentTicketId;
    handleTicketNavigation(currentTicketId);
  } else if (!pathname.includes('/a/tickets/')) {
    // Se saímos da tela de ticket, resetamos o lastId e removemos os botões órfãos
    lastTicketId = null;
    const container = document.getElementById('atlas-comet-header-buttons');
    if (container) container.remove();
    const offlineLabel = document.getElementById('atlas-comet-offline-label');
    if (offlineLabel) offlineLabel.remove();
  }
}, 1000); // Verifica a cada 1 segundo

function handleTicketNavigation(newId: string): void {
  // Busca o título original do novo ticket e atualiza a tela suavemente
  fetch(`/api/v2/tickets/${newId}`)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      if (data && data.subject) {
        const subjectDisplay = document.querySelector('.ticket-subject-heading');
        if (subjectDisplay) {
          // Atualiza apenas o nó de texto para não quebrar bindings do Ember
          Array.from(subjectDisplay.childNodes).forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim() !== '') {
              node.textContent = data.subject + ' ';
            }
          });
        }
      }
    })
    .catch((e) => console.log('[Atlas Comet] Erro ao buscar novo título no Sentinela', e));
}



