import { CONSTANTS } from './constants';
import { LookupService, FieldChoice } from './lookup';
import { FreshdeskAPI } from './api';
import { ContextManager } from './context';
import lottie from 'lottie-web';
import loaderJson from './loader_data';

/**
 * Secure UI Factory for the Freshdesk New Ticket page (/a/tickets/new).
 *
 * Purpose:
 * Generates and manages Atlas Comet UI elements on the new ticket creation form.
 * Provides a comprehensive modal with all required fields for ticket creation,
 * including service selection (N1/N2/N3), contact search, origin, type, status,
 * priority, group, agent, product, subject, and description.
 *
 * Architecture:
 * - Each field supports independent memorization via chrome.storage.local
 * - Memorization keys are separate from the existing ticket modal
 * - After the user fills all fields and clicks "Criar novo Ticket", the extension
 *   programmatically fills the native Freshdesk form fields and clicks the native
 *   submit button to create the ticket
 *
 * Security:
 * All DOM nodes are built via deterministic DOM APIs (createElement, textContent).
 * innerHTML is used ONLY for static SVG icons, never for dynamic content.
 */
export class NewTicketUIFactory {
  /**
   * Base inline style for Atlas Comet buttons — consistent with the ticket UI.
   */
  private static readonly BASE_BTN_STYLE =
    'display: inline-flex !important; align-items: center !important; justify-content: center !important; height: 32px !important; padding: 0 12px !important; border-radius: 10px !important; font-size: 14px !important; font-weight: 600 !important; line-height: 1.2 !important; cursor: pointer !important; white-space: nowrap !important; box-sizing: border-box !important; margin: 0 !important; vertical-align: middle !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important; transition: all 0.2s ease-in-out !important;';

  /**
   * Renders the "Definir Serviço" button on the new ticket page.
   *
   * @param headerContainer - The detected header container element, or null.
   */
  public static renderNewTicketButton(headerContainer: HTMLElement | null): void {
    // Prevent duplicate injection
    if (document.getElementById('atlas-comet-newticket-buttons')) return;

    // Create the main container
    const container = document.createElement('div');
    container.id = 'atlas-comet-newticket-buttons';
    container.style.cssText =
      'display: inline-flex; align-items: center; gap: 6px; margin-right: 8px; z-index: 50; height: 32px; vertical-align: middle;';

    // "Definir Serviço" Button
    const btnService = document.createElement('button');
    btnService.id = 'atlas-comet-newticket-service-btn';
    btnService.style.cssText =
      this.BASE_BTN_STYLE +
      ' background: #29735c !important; color: #fbfbf9 !important; border: 1px solid rgba(45, 121, 102, 0.1) !important; border-bottom: 2px solid #02ac85 !important; box-shadow: 0 1px 3px rgba(39, 103, 92, 0.1) !important;';
    btnService.textContent = 'Definir Serviço';
    btnService.addEventListener('mouseenter', () => {
      btnService.style.opacity = '0.85';
    });
    btnService.addEventListener('mouseleave', () => {
      btnService.style.opacity = '1';
    });
    btnService.onclick = async () => {
      const origText = btnService.textContent;
      btnService.textContent = 'Carregando...';
      btnService.style.pointerEvents = 'none';
      btnService.style.opacity = '0.7';
      try {
        // Force fresh data sync when opening the modal
        await LookupService.init(true);
        this.openNewTicketModal();
      } catch (e) {
        console.error('[Atlas Comet] Falha ao iniciar LookupService para novo ticket', e);
        const msg = e instanceof Error ? e.message : String(e);
        alert(
          `Erro ao sincronizar campos do Freshdesk: ${msg}\n\nVerifique sua conexão e tente novamente.`,
        );
      } finally {
        btnService.textContent = origText;
        btnService.style.pointerEvents = 'auto';
        btnService.style.opacity = '1';
      }
    };
    container.appendChild(btnService);

    // Find target element to inject
    console.log('[Atlas Comet] Tentando injetar botão Definir Serviço. Elemento alvo:', headerContainer);
    if (headerContainer) {
      if (headerContainer.classList.contains('breadcrumb-title') || headerContainer.getAttribute('data-test-title') === 'main-title') {
        // Se encontramos o título exato, insere o botão logo após ele para ficar colado à direita do texto
        console.log('[Atlas Comet] Injetando botão logo após o título principal (esquerda).');
        container.style.marginLeft = '12px';
        container.style.display = 'inline-flex';
        
        if (headerContainer.parentElement) {
          headerContainer.parentElement.style.display = 'flex';
          headerContainer.parentElement.style.alignItems = 'center';
        }
        
        headerContainer.insertAdjacentElement('afterend', container);
      } else {
        console.log('[Atlas Comet] Injetando botão com appendChild no headerContainer.', headerContainer.className);
        headerContainer.appendChild(container);
      }
    }
  }

  // ─── Modal Lifecycle ──────────────────────────────────────────────────────

  /**
   * Opens the New Ticket modal as a full-screen overlay.
   */
  private static openNewTicketModal(): void {
    if (document.getElementById(CONSTANTS.NEW_TICKET_MODAL_ID)) return;

    const overlay = document.createElement('div');
    overlay.id = CONSTANTS.NEW_TICKET_MODAL_ID;
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

    this.renderModalContents(modalBody, overlay);
  }

  // ─── Modal Contents ───────────────────────────────────────────────────────

  /**
   * Renders all the modal content: title, fields, and action buttons.
   *
   * Field order (memorizable fields first, as requested):
   * 1. Origem (memorizable)
   * 2. Contato (with search + add new / add Cc links)
   * 3. Tipo (memorizable)
   * 4. Serviço Nível (search with N2/N3 filters, memorizable)
   * 5. Status (memorizable)
   * 6. Prioridade (memorizable)
   * 7. Grupo (memorizable)
   * 8. Agente (memorizable, depends on Grupo)
   * 9. Produto (memorizable)
   * 10. Assunto (text input)
   * 11. Descrição (textarea)
   *
   * @param modalBody - The modal container element.
   * @param overlay - The overlay element for closing.
   */
  private static renderModalContents(modalBody: HTMLElement, overlay: HTMLElement): void {
    // Clear existing content
    while (modalBody.firstChild) modalBody.removeChild(modalBody.firstChild);

    // ─── Title ──────────────────────────────────────────────────────────
    const title = document.createElement('h2');
    title.style.cssText =
      'color: #2d7966; margin: 0 0 12px 0; font-size: 18px; display: flex; align-items: center; gap: 8px;';

    const titleIcon = document.createElement('span');
    titleIcon.style.cssText =
      'display: inline-flex; align-items: center; flex-shrink: 0; color: #02ac85;';
    titleIcon.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l7.07 17 2.51-7.39L21 11.07z"/></svg>';
    title.appendChild(titleIcon);
    title.appendChild(document.createTextNode('Novo Ticket — Definir Serviço'));
    modalBody.appendChild(title);



    // ─── Inline Validation Helper ─────────────────────────────────────────
    const showValidationError = (inputElement: HTMLElement, wrapperElement: HTMLElement, message: string) => {
      // Create or update error banner
      let banner = wrapperElement.querySelector('.atlas-validation-banner') as HTMLElement;
      if (!banner) {
        banner = document.createElement('div');
        banner.className = 'atlas-validation-banner';
        banner.style.cssText = 'background-color: #e74c3c; color: #fff; font-size: 12px; padding: 6px 10px; border-radius: 4px; margin-top: 4px; display: flex; align-items: center; gap: 6px; animation: atlas-comet-fade-in 0.2s ease-out;';
        const iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
        banner.innerHTML = `${iconSvg} <span>${message}</span>`;
        wrapperElement.appendChild(banner);
      } else {
        const span = banner.querySelector('span');
        if (span) span.textContent = message;
      }

      // Add shake animation and red border
      inputElement.animate([
        { transform: 'translateX(0)' },
        { transform: 'translateX(-4px)' },
        { transform: 'translateX(4px)' },
        { transform: 'translateX(-4px)' },
        { transform: 'translateX(4px)' },
        { transform: 'translateX(0)' }
      ], { duration: 400, easing: 'ease-in-out' });
      
      const originalBorder = inputElement.style.borderColor;
      inputElement.style.setProperty('border-color', '#e74c3c', 'important');

      // Clear error on next interaction
      const clearError = () => {
        if (banner && banner.parentNode) {
          banner.parentNode.removeChild(banner);
        }
        inputElement.style.borderColor = originalBorder;
        inputElement.removeEventListener('input', clearError);
        inputElement.removeEventListener('change', clearError);
        inputElement.removeEventListener('focus', clearError);
      };
      inputElement.addEventListener('input', clearError);
      inputElement.addEventListener('change', clearError);
      inputElement.addEventListener('focus', clearError);
    };

    // ─── Scrollable form container ──────────────────────────────────────
    const formContainer = document.createElement('div');
    formContainer.style.cssText =
      'overflow-y: auto; flex: 1; padding-right: 4px;';

    // ─── Shared styles ──────────────────────────────────────────────────
    const labelStyle =
      'display: flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 600; color: #27675c; margin-bottom: 6px;';
    const inputStyle = `
      width: 100%; padding: 10px 12px; font-size: 14px; border: 2px solid #ddd;
      border-radius: 6px; outline: none; box-sizing: border-box;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    `;
    const selectWrapperStyle = 'position: relative; margin-bottom: 14px;';
    // memoBtnBaseStyle removed
    const bookmarkSvg =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
    const checkSvg =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

    // ─── Helper: create a memorizable dropdown field ────────────────────
    /**
     * Creates a complete dropdown field with label, select element, and
     * a "Lembrar" button for persisting the selected value.
     *
     * Updated to accept FieldChoice[] (from LookupService) instead of plain
     * string arrays. Each option carries both a human-readable label and a
     * numeric API ID as its value.
     *
     * @param labelText - The field label text.
     * @param choices - Array of FieldChoice from LookupService (label + numeric value).
     * @param defaultId - The default numeric ID to pre-select.
     * @param storageKey - chrome.storage.local key for memorization.
     * @returns Object with { wrapper, select } for further manipulation.
     */
    const createDropdownField = (
      labelText: string,
      choices: FieldChoice[],
      _defaultId: number,
      _storageKey: string,
    ): { wrapper: HTMLDivElement; select: HTMLSelectElement } => {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = selectWrapperStyle;
      void _defaultId; void _storageKey;

      // Label row with memorize button
      const labelRow = document.createElement('div');
      labelRow.style.cssText = 'display: flex; align-items: center; margin-bottom: 6px;';

      const label = document.createElement('label');
      label.style.cssText = labelStyle;
      label.textContent = labelText;

      labelRow.appendChild(label);
      wrapper.appendChild(labelRow);

      // Select element — each option's value is the numeric API ID
      const select = document.createElement('select');
      select.style.cssText = inputStyle + ' cursor: pointer;';

      const emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = 'Selecione...';
      select.appendChild(emptyOption);

      for (const choice of choices) {
        const option = document.createElement('option');
        option.value = String(choice.value);    // Numeric ID as string
        option.textContent = choice.label;      // Human-readable label
        // if (choice.value === defaultId) option.selected = true; // Removed to force empty by default
        select.appendChild(option);
      }

      select.addEventListener('focus', () => {
        select.style.borderColor = '#02ac85';
        select.style.boxShadow = '0 0 0 3px rgba(172, 254, 223, 0.2)';
      });
      select.addEventListener('blur', () => {
        select.style.borderColor = '#ddd';
        select.style.boxShadow = 'none';
      });

      wrapper.appendChild(select);



      return { wrapper, select };
    };

    // ═══════════════════════════════════════════════════════════════════════
    // FIELD 1: Origem (filtered from API data)
    // Only displays the labels specified in CONSTANTS.VALUES.ORIGEM_DISPLAY_FILTER
    // while retaining the correct numeric IDs from the API.
    // ═══════════════════════════════════════════════════════════════════════
    const allSources = LookupService.getSources();
    const filterLabels = CONSTANTS.VALUES.ORIGEM_DISPLAY_FILTER.map(
      (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(),
    );
    const filteredSources = allSources.filter((src) => {
      const normalized = src.label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      return filterLabels.includes(normalized);
    });
    // Use filtered sources if available, otherwise fall back to full list
    const origemChoices = filteredSources.length > 0 ? filteredSources : allSources;
    const origemField = createDropdownField(
      'Origem',
      origemChoices,
      CONSTANTS.VALUES.DEFAULT_ORIGEM_ID,
      CONSTANTS.STORAGE.NEW_TICKET_ORIGEM,
    );
    formContainer.appendChild(origemField.wrapper);

    // ═══════════════════════════════════════════════════════════════════════
    // FIELD 2: Contato (search with autocomplete)
    // ═══════════════════════════════════════════════════════════════════════
    const contatoWrapper = document.createElement('div');
    contatoWrapper.style.cssText = selectWrapperStyle;

    // Label row with memorize button (same pattern as other memorizable fields)
    const contatoLabelRow = document.createElement('div');
    contatoLabelRow.style.cssText = 'display: flex; align-items: center; margin-bottom: 6px;';

    const contatoLabel = document.createElement('label');
    contatoLabel.style.cssText = labelStyle;
    contatoLabel.textContent = 'Contato';

    contatoLabelRow.appendChild(contatoLabel);
    contatoWrapper.appendChild(contatoLabelRow);

    const contatoInput = document.createElement('input');
    contatoInput.type = 'text';
    contatoInput.placeholder = 'Buscar contato por nome ou e-mail...';
    contatoInput.style.cssText = inputStyle;

    const contatoResultsContainer = document.createElement('ul');
    contatoResultsContainer.style.cssText = `
      list-style: none; padding: 0; margin: 4px 0 0 0; position: absolute;
      top: calc(100%); left: 0; width: 100%; background: white; z-index: 1001;
      overflow-y: auto; max-height: 200px; border: 1px solid #ddd; border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: none;
    `;

    /** Stores the selected contact data { id, name, email } */
    let selectedContact: { id: number; name: string; email: string } | null = null;

    let contatoSearchTimeout: ReturnType<typeof setTimeout> | null = null;

    contatoInput.addEventListener('focus', () => {
      contatoInput.style.borderColor = '#02ac85';
      contatoInput.style.boxShadow = '0 0 0 3px rgba(172, 254, 223, 0.2)';
    });
    contatoInput.addEventListener('blur', () => {
      contatoInput.style.borderColor = '#ddd';
      contatoInput.style.boxShadow = 'none';
      // Delay hiding to allow click to register
      setTimeout(() => {
        contatoResultsContainer.style.display = 'none';
      }, 200);
    });
    contatoInput.addEventListener('input', () => {
      selectedContact = null;
      const query = contatoInput.value.trim();
      if (query.length < 2) {
        contatoResultsContainer.style.display = 'none';
        return;
      }

      // Debounce search requests (300ms)
      if (contatoSearchTimeout) clearTimeout(contatoSearchTimeout);
      contatoSearchTimeout = setTimeout(async () => {
        try {
          const url = `/api/_/search/autocomplete/requesters`;
          console.log('[Atlas Comet] Buscando contatos em:', url);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let contacts = (await FreshdeskAPI.sendBridgeRequest(url, 'POST', { term: query })) as any;
          console.log('[Atlas Comet] Resposta bruta de contatos:', contacts);

          // A API interna pode retornar os contatos dentro de uma chave 'contacts' ou direto no array
          if (!Array.isArray(contacts) && contacts.contacts) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            contacts = contacts.contacts as any[];
          } else if (!Array.isArray(contacts)) {
            // fallback if it's some other object structure
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            contacts = (Object.values(contacts).find(val => Array.isArray(val)) as any[]) || [];
          }
          
          console.log('[Atlas Comet] Array de contatos extraído:', contacts);

          while (contatoResultsContainer.firstChild)
            contatoResultsContainer.removeChild(contatoResultsContainer.firstChild);

          if (contacts.length === 0) {
            const emptyItem = document.createElement('li');
            emptyItem.style.cssText =
              'padding: 8px 12px; text-align: center; color: #999; font-size: 13px;';
            emptyItem.textContent = 'Nenhum contato encontrado.';
            contatoResultsContainer.appendChild(emptyItem);
          } else {
            for (const contact of contacts.slice(0, 10)) {
              const li = document.createElement('li');
              li.style.cssText = `
                padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #f0f0f0;
                font-size: 13px; color: #333; transition: background 0.15s ease;
              `;

              const nameSpan = document.createElement('span');
              nameSpan.style.cssText = 'font-weight: 600;';
              nameSpan.textContent = contact.name || contact.email || 'Sem Nome';

              const emailSpan = document.createElement('span');
              emailSpan.style.cssText = 'color: #999; font-size: 12px; margin-left: 8px;';
              emailSpan.textContent = contact.email ? `<${contact.email}>` : '';

              li.appendChild(nameSpan);
              li.appendChild(emailSpan);

              li.addEventListener('mouseenter', () => {
                li.style.background = '#f0f7ff';
              });
              li.addEventListener('mouseleave', () => {
                li.style.background = 'transparent';
              });
              li.addEventListener('mousedown', (e) => {
                e.preventDefault();
                selectedContact = {
                  id: contact.id,
                  name: contact.name || contact.email || '',
                  email: contact.email || '',
                };
                contatoInput.value = selectedContact.name
                  ? `"${selectedContact.name}" <${selectedContact.email}>`
                  : selectedContact.email;
                contatoResultsContainer.style.display = 'none';
              });

              contatoResultsContainer.appendChild(li);
            }
          }

          contatoResultsContainer.style.display = 'block';
        } catch (e) {
          console.error('[Atlas Comet] Erro ao buscar contatos:', e);
        }
      }, 300);
    });

    contatoWrapper.appendChild(contatoInput);
    contatoWrapper.appendChild(contatoResultsContainer);



    formContainer.appendChild(contatoWrapper);

    // ═══════════════════════════════════════════════════════════════════════
    // FIELD 3: Tipo (with search dropdown, same pattern as ticket modal)
    // ═══════════════════════════════════════════════════════════════════════
    const tipoWrapper = document.createElement('div');
    tipoWrapper.style.cssText = selectWrapperStyle;

    const tipoLabelRow = document.createElement('div');
    tipoLabelRow.style.cssText = 'display: flex; align-items: center; margin-bottom: 6px;';

    const tipoLabel = document.createElement('label');
    tipoLabel.style.cssText = labelStyle;
    tipoLabel.textContent = 'Tipo do Ticket';

    tipoLabelRow.appendChild(tipoLabel);
    tipoWrapper.appendChild(tipoLabelRow);

    const tipoInput = document.createElement('input');
    tipoInput.type = 'text';
    tipoInput.placeholder = 'Digite para buscar o tipo...';
    tipoInput.value = '';
    tipoInput.style.cssText = inputStyle;

    const tipoResultsContainer = document.createElement('ul');
    tipoResultsContainer.className = 'atlas-tipo-results';
    tipoResultsContainer.style.display = 'none';

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
        li.addEventListener('mouseenter', () => { li.style.background = '#f0f7ff'; });
        li.addEventListener('mouseleave', () => { li.style.background = 'transparent'; });
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

    // Tipo memo button


    tipoWrapper.appendChild(tipoInput);
    tipoWrapper.appendChild(tipoResultsContainer);
    formContainer.appendChild(tipoWrapper);

    // ═══════════════════════════════════════════════════════════════════════
    // FIELD 4: Serviço Nível (search with N2/N3 filters)
    // ═══════════════════════════════════════════════════════════════════════
    const servicoContainer = document.createElement('div');
    servicoContainer.style.cssText = selectWrapperStyle;

    const servicoLabelRow = document.createElement('div');
    servicoLabelRow.style.cssText = 'display: flex; align-items: center; margin-bottom: 6px;';

    const servicoLabel = document.createElement('label');
    servicoLabel.style.cssText = labelStyle;
    servicoLabel.textContent = 'Buscar Serviço (Nível 2 ou 3)';

    servicoLabelRow.appendChild(servicoLabel);
    servicoContainer.appendChild(servicoLabelRow);

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
    searchInput.placeholder = 'Digite o assunto do serviço...';
    searchInput.style.cssText = `
      width: 100%; padding: 10px 12px 10px 34px; font-size: 14px; border: 2px solid #ddd;
      border-radius: 6px; outline: none; box-sizing: border-box;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    `;

    searchWrapper.appendChild(searchIcon);
    searchWrapper.appendChild(searchInput);
    servicoContainer.appendChild(searchWrapper);

    searchInput.addEventListener('focus', () => {
      searchInput.style.borderColor = '#02ac85';
      searchInput.style.boxShadow = '0 0 0 3px rgba(172, 254, 223, 0.2)';
    });
    searchInput.addEventListener('blur', () => {
      searchInput.style.borderColor = '#ddd';
      searchInput.style.boxShadow = 'none';
    });

    // Level filter checkboxes
    const filterRow = document.createElement('div');
    filterRow.style.cssText =
      'display: flex; align-items: center; gap: 16px; margin: 10px 0 4px 0; flex-wrap: wrap;';

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

    const prefsBtn = document.createElement('button');
    prefsBtn.type = 'button';
    prefsBtn.style.cssText = 'background: none; border: none; font-size: 11px; color: #777; cursor: pointer; display: flex; align-items: center; gap: 4px; margin-left: auto; border: 1px solid #ccc; padding: 2px 6px; border-radius: 4px; transition: all 0.2s ease;';
    prefsBtn.innerHTML = bookmarkSvg;
    prefsBtn.appendChild(document.createTextNode(' Lembrar Preferências'));
    prefsBtn.addEventListener('mouseenter', () => { if (!prefsBtn.dataset.saved) { prefsBtn.style.borderColor = '#02ac85'; prefsBtn.style.color = '#02ac85'; } });
    prefsBtn.addEventListener('mouseleave', () => { if (!prefsBtn.dataset.saved) { prefsBtn.style.borderColor = '#ccc'; prefsBtn.style.color = '#777'; } });
    prefsBtn.addEventListener('click', () => {
      chrome.storage.local.set(
        { [CONSTANTS.STORAGE.NEW_TICKET_LEVEL_PREFS]: { n3: cbN3.checked, n2: cbN2.checked } },
        () => {
          prefsBtn.dataset.saved = 'true';
          prefsBtn.style.background = '#02ac85'; prefsBtn.style.borderColor = '#02ac85'; prefsBtn.style.color = '#fff';
          prefsBtn.innerHTML = checkSvg; prefsBtn.appendChild(document.createTextNode(' Salvo'));
          setTimeout(() => {
            delete prefsBtn.dataset.saved;
            prefsBtn.style.background = 'transparent'; prefsBtn.style.borderColor = '#ccc'; prefsBtn.style.color = '#777';
            prefsBtn.innerHTML = bookmarkSvg; prefsBtn.appendChild(document.createTextNode(' Lembrar Preferências'));
          }, 2000);
        }
      );
    });

    filterRow.appendChild(cbN2Label);
    filterRow.appendChild(cbN3Label);
    servicoContainer.appendChild(filterRow);

    // Service results container
    const resultsContainer = document.createElement('ul');
    resultsContainer.className = 'atlas-results-container';
    resultsContainer.style.cssText += ' max-height: 180px; min-height: 100px;';

    /** Stores the selected service entry */
    let selectedService: { n1: string; n2: string; n3: string } | null = null;

    /** Badge showing the selected service */
    const selectedServiceBadge = document.createElement('div');
    selectedServiceBadge.style.cssText =
      'display: none; margin: 8px 0; padding: 8px 12px; background: #d1fae5; border-radius: 6px; font-size: 13px; color: #065f46; font-weight: 500;';

    const getAllowedLevels = (): Set<number> => {
      const levels = new Set<number>();
      if (cbN3.checked) levels.add(3);
      if (cbN2.checked) levels.add(2);
      return levels;
    };

    const runSearch = () => {
      const levels = getAllowedLevels();
      if (levels.size === 0) {
        while (resultsContainer.firstChild)
          resultsContainer.removeChild(resultsContainer.firstChild);
        const warningItem = document.createElement('li');
        warningItem.style.cssText =
          'padding: 16px; text-align: center; color: #999; font-size: 14px;';
        warningItem.textContent =
          '⚠️ Selecione pelo menos um nível (N2 ou N3) para visualizar os serviços.';
        resultsContainer.appendChild(warningItem);
        return;
      }

      const query = searchInput.value;
      const filtered = LookupService.searchLeaves(query, levels);

      // Clear previous results
      while (resultsContainer.firstChild)
        resultsContainer.removeChild(resultsContainer.firstChild);

      if (filtered.length === 0) {
        const emptyItem = document.createElement('li');
        emptyItem.style.cssText = 'padding: 16px; text-align: center; color: #999; font-size: 14px;';
        emptyItem.textContent = query.trim()
          ? `Não encontramos nada para "${query}".`
          : 'Nenhum resultado encontrado.';
        resultsContainer.appendChild(emptyItem);
        return;
      }

      for (const entry of filtered) {
        const li = document.createElement('li');
        li.style.cssText = `
          padding: 10px 14px; cursor: pointer; border-bottom: 1px solid #f0f0f0;
          transition: background 0.15s ease; margin-bottom: 2px;
        `;

        li.addEventListener('mouseenter', () => { li.style.background = '#f0f7ff'; });
        li.addEventListener('mouseleave', () => { li.style.background = 'transparent'; });

        // Title row with badge
        const titleRow = document.createElement('div');
        titleRow.style.cssText = 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap;';

        const labelSpan = document.createElement('span');
        labelSpan.style.cssText = 'font-size: 14px; font-weight: 600; color: #29735c;';
        labelSpan.textContent = entry.label;
        titleRow.appendChild(labelSpan);

        // N1 Badge
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
          `;
          badge.textContent = n1Label;
          titleRow.appendChild(badge);
        }

        li.appendChild(titleRow);

        // Breadcrumb
        const breadcrumb = LookupService.getBreadcrumb(entry);
        if (breadcrumb) {
          const fullPath = `${breadcrumb} > ${entry.label}`;
          const breadcrumbSpan = document.createElement('span');
          breadcrumbSpan.style.cssText =
            'display: block; font-size: 11px; color: #999; margin-top: 3px;';
          breadcrumbSpan.textContent = fullPath;
          li.appendChild(breadcrumbSpan);
        }

        // Click handler: select this service
        li.addEventListener('click', () => {
          const chain = LookupService.getParentChain(entry.choiceId);
          if (chain.length === 0) return;

          const n1 = chain.find((e) => e.level === 1)?.label ?? '';
          const n2 = chain.find((e) => e.level === 2)?.label ?? '';
          const n3 = chain.find((e) => e.level === 3)?.label ?? '';

          selectedService = { n1, n2, n3 };

          // Show selected service badge
          selectedServiceBadge.textContent = `✅ Serviço selecionado: ${n1} > ${n2}${n3 ? ' > ' + n3 : ''}`;
          selectedServiceBadge.style.display = 'block';
        });

        resultsContainer.appendChild(li);
      }
    };

    searchInput.addEventListener('input', runSearch);
    cbN3.addEventListener('change', runSearch);
    cbN2.addEventListener('change', runSearch);

    servicoContainer.appendChild(resultsContainer);
    servicoContainer.appendChild(selectedServiceBadge);



    formContainer.appendChild(servicoContainer);

    // ═══════════════════════════════════════════════════════════════════════
    // FIELD 5: Status
    // ═══════════════════════════════════════════════════════════════════════
    const statusField = createDropdownField(
      'Status',
      LookupService.getStatuses(),
      CONSTANTS.VALUES.DEFAULT_STATUS_ID,
      CONSTANTS.STORAGE.NEW_TICKET_STATUS,
    );
    formContainer.appendChild(statusField.wrapper);

    // ═══════════════════════════════════════════════════════════════════════
    // FIELD 6: Prioridade
    // ═══════════════════════════════════════════════════════════════════════
    const prioridadeField = createDropdownField(
      'Prioridade',
      LookupService.getPriorities(),
      CONSTANTS.VALUES.DEFAULT_PRIORIDADE_ID,
      CONSTANTS.STORAGE.NEW_TICKET_PRIORIDADE,
    );
    formContainer.appendChild(prioridadeField.wrapper);

    // ═══════════════════════════════════════════════════════════════════════
    // FIELD 7: Grupo (loads agents dynamically)
    // ═══════════════════════════════════════════════════════════════════════
    const grupoWrapper = document.createElement('div');
    grupoWrapper.style.cssText = selectWrapperStyle;

    const grupoLabelRow = document.createElement('div');
    grupoLabelRow.style.cssText = 'display: flex; align-items: center; margin-bottom: 6px;';

    const grupoLabel = document.createElement('label');
    grupoLabel.style.cssText = labelStyle;
    grupoLabel.textContent = 'Grupo';

    grupoLabelRow.appendChild(grupoLabel);
    grupoWrapper.appendChild(grupoLabelRow);

    const grupoSelect = document.createElement('select');
    grupoSelect.style.cssText = inputStyle + ' cursor: pointer;';
    const grupoDefaultOpt = document.createElement('option');
    grupoDefaultOpt.value = '';
    grupoDefaultOpt.textContent = 'Carregando grupos...';
    grupoSelect.appendChild(grupoDefaultOpt);

    grupoSelect.addEventListener('focus', () => {
      grupoSelect.style.borderColor = '#02ac85';
      grupoSelect.style.boxShadow = '0 0 0 3px rgba(172, 254, 223, 0.2)';
    });
    grupoSelect.addEventListener('blur', () => {
      grupoSelect.style.borderColor = '#ddd';
      grupoSelect.style.boxShadow = 'none';
    });

    grupoWrapper.appendChild(grupoSelect);
    formContainer.appendChild(grupoWrapper);

    // ═══════════════════════════════════════════════════════════════════════
    // FIELD 8: Agente (depends on Grupo)
    // ═══════════════════════════════════════════════════════════════════════
    const agenteWrapper = document.createElement('div');
    agenteWrapper.style.cssText = selectWrapperStyle;

    const agenteLabelRow = document.createElement('div');
    agenteLabelRow.style.cssText = 'display: flex; align-items: center; margin-bottom: 6px;';

    const agenteLabel = document.createElement('label');
    agenteLabel.style.cssText = labelStyle;
    agenteLabel.textContent = 'Agente';

    agenteLabelRow.appendChild(agenteLabel);
    agenteWrapper.appendChild(agenteLabelRow);

    const agenteSelect = document.createElement('select');
    agenteSelect.style.cssText = inputStyle + ' cursor: pointer;';
    const agenteDefaultOpt = document.createElement('option');
    agenteDefaultOpt.value = '';
    agenteDefaultOpt.textContent = 'Selecione um grupo primeiro';
    agenteSelect.appendChild(agenteDefaultOpt);

    agenteSelect.addEventListener('focus', () => {
      agenteSelect.style.borderColor = '#02ac85';
      agenteSelect.style.boxShadow = '0 0 0 3px rgba(172, 254, 223, 0.2)';
    });
    agenteSelect.addEventListener('blur', () => {
      agenteSelect.style.borderColor = '#ddd';
      agenteSelect.style.boxShadow = 'none';
    });

    agenteWrapper.appendChild(agenteSelect);
    formContainer.appendChild(agenteWrapper);

    // Grupo → Agente dynamic loading
    grupoSelect.addEventListener('change', async () => {
      const groupId = grupoSelect.value;
      const groupName = grupoSelect.options[grupoSelect.selectedIndex]?.text;
      
      while (agenteSelect.firstChild) agenteSelect.removeChild(agenteSelect.firstChild);

      if (!groupId) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Selecione um grupo primeiro';
        agenteSelect.appendChild(opt);
        return;
      }

      const loadingOpt = document.createElement('option');
      loadingOpt.value = '';
      loadingOpt.textContent = 'Buscando agentes...';
      agenteSelect.appendChild(loadingOpt);

      try {
        console.log(`[Atlas Comet] Buscando agentes para o grupo: ${groupName} (ID: ${groupId})`);
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const realAgents: any[] = [];

        // ─── Strategy 1: Internal API with group filter ──────────────────
        // The internal Freshdesk API (/api/_/) uses the same session cookies
        // as the logged-in agent's browser session, so it works without
        // admin-level API permissions. Unlike the V2 API, the internal agents
        // endpoint supports direct group_id filtering.
        try {
          console.log(`[Atlas Comet] Tentativa 1: GET /api/_/agents?group_id=${groupId}...`);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const res = await FreshdeskAPI.sendBridgeRequest(`/api/_/agents?group_id=${groupId}`, 'GET') as any;
          
          // The internal API may return agents in various structures
          const agents = Array.isArray(res) ? res : (res?.agents || []);
          if (agents.length > 0) {
            realAgents.push(...agents);
            console.log(`[Atlas Comet] Tentativa 1 bem-sucedida: ${realAgents.length} agentes encontrados.`);
          }
        } catch (e) {
          console.warn('[Atlas Comet] Tentativa 1 falhou (GET /api/_/agents):', e);
        }

        // ─── Strategy 2: Internal group details with agent list ───────────
        // If strategy 1 failed, fetch the group details via internal API.
        // The response may include an embedded agent list or agent_ids.
        if (realAgents.length === 0) {
          try {
            console.log(`[Atlas Comet] Tentativa 2: GET /api/_/groups/${groupId}...`);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const groupData = await FreshdeskAPI.sendBridgeRequest(`/api/_/groups/${groupId}`, 'GET') as any;
            
            // The internal groups endpoint may embed agents directly
            const groupObj = groupData?.group || groupData;
            const embeddedAgents = groupObj?.agents || [];

            if (Array.isArray(embeddedAgents) && embeddedAgents.length > 0) {
              realAgents.push(...embeddedAgents);
              console.log(`[Atlas Comet] Tentativa 2 bem-sucedida (agentes embutidos): ${realAgents.length}`);
            } else {
              // Alternatively, extract agent_ids and fetch each one from internal API
              const agentIds: number[] = groupObj?.agent_ids || [];
              if (agentIds.length > 0) {
                console.log(`[Atlas Comet] Tentativa 2: Buscando ${agentIds.length} agentes individualmente...`);
                const batchSize = 20;
                for (let i = 0; i < agentIds.length; i += batchSize) {
                  const batch = agentIds.slice(i, i + batchSize);
                  const batchResults = await Promise.allSettled(
                    batch.map((aid) =>
                      FreshdeskAPI.sendBridgeRequest(`/api/_/agents/${aid}`, 'GET'),
                    ),
                  );
                  for (const result of batchResults) {
                    if (result.status === 'fulfilled' && result.value) {
                      realAgents.push(result.value);
                    }
                  }
                }
                console.log(`[Atlas Comet] Tentativa 2 finalizada: ${realAgents.length} agentes carregados.`);
              }
            }
          } catch (e2) {
            console.warn('[Atlas Comet] Tentativa 2 falhou (GET /api/_/groups/{id}):', e2);
          }
        }

        while (agenteSelect.firstChild) agenteSelect.removeChild(agenteSelect.firstChild);

        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = '-- Selecionar Agente --';
        agenteSelect.appendChild(emptyOpt);

        if (realAgents.length === 0) {
          console.warn('[Atlas Comet] Nenhum agente encontrado para este grupo após todas as tentativas.');
        } else {
          // Map agents to our final list format
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const finalAgents = realAgents.map((ra: any) => {
            return {
              id: ra.id,
              name: ra.contact?.name || ra.name || `Agente #${ra.id}`
            };
          });

          console.log(`[Atlas Comet] Agentes extraídos para o grupo ${groupId}:`, finalAgents);

          finalAgents.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

          for (const agent of finalAgents) {
            const opt = document.createElement('option');
            opt.setAttribute('data-name', agent.name);
            opt.value = String(agent.id);
            opt.textContent = agent.name;
            agenteSelect.appendChild(opt);
          }
        }

        // Restore saved agent preference
        if (ContextManager.isValid()) {
          chrome.storage.local.get(CONSTANTS.STORAGE.NEW_TICKET_AGENTE, (result) => {
            const saved = result[CONSTANTS.STORAGE.NEW_TICKET_AGENTE];
            if (saved && saved.id) {
              agenteSelect.value = String(saved.id);
            }
          });
        }
      } catch (e) {
        console.error('[Atlas Comet] Erro ao carregar agentes:', e);
        while (agenteSelect.firstChild) agenteSelect.removeChild(agenteSelect.firstChild);
        const errorOpt = document.createElement('option');
        errorOpt.value = '';
        errorOpt.textContent = 'Erro ao carregar agentes';
        agenteSelect.appendChild(errorOpt);
      }
    });



    // ═══════════════════════════════════════════════════════════════════════
    // FIELD 9: Produto (dynamic from API)
    // ═══════════════════════════════════════════════════════════════════════
    const productChoices = LookupService.getProducts();
    // Use first product as default if available, otherwise 0
    const defaultProductId = productChoices.length > 0 ? productChoices[0].value : 0;
    const produtoField = createDropdownField(
      'Produto',
      productChoices,
      defaultProductId,
      CONSTANTS.STORAGE.NEW_TICKET_PRODUTO,
    );
    formContainer.appendChild(produtoField.wrapper);

    // ═══════════════════════════════════════════════════════════════════════
    // FIELD 9.5: Tags (search with autocomplete)
    // ═══════════════════════════════════════════════════════════════════════
    const tagWrapper = document.createElement('div');
    tagWrapper.style.cssText = selectWrapperStyle;

    const tagLabelRow = document.createElement('div');
    tagLabelRow.style.cssText = 'display: flex; align-items: center; margin-bottom: 6px;';

    const tagLabel = document.createElement('label');
    tagLabel.style.cssText = labelStyle;
    tagLabel.textContent = 'Tags';

    tagLabelRow.appendChild(tagLabel);
    tagWrapper.appendChild(tagLabelRow);

    const tagInput = document.createElement('input');
    tagInput.type = 'text';
    tagInput.placeholder = 'Buscar tags cadastradas...';
    tagInput.style.cssText = inputStyle;

    const tagResultsContainer = document.createElement('ul');
    tagResultsContainer.style.cssText = `
      list-style: none; padding: 0; margin: 4px 0 0 0; position: absolute;
      top: calc(100%); left: 0; width: 100%; background: white; z-index: 1001;
      overflow-y: auto; max-height: 200px; border: 1px solid #ddd; border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: none;
    `;

    /** Stores the selected tag data { id, value } */
    let selectedTag: { id: number; value: string } | null = null;
    let tagSearchTimeout: ReturnType<typeof setTimeout> | null = null;

    tagInput.addEventListener('focus', () => {
      tagInput.style.borderColor = '#02ac85';
      tagInput.style.boxShadow = '0 0 0 3px rgba(172, 254, 223, 0.2)';
    });
    tagInput.addEventListener('blur', () => {
      tagInput.style.borderColor = '#ddd';
      tagInput.style.boxShadow = 'none';
      setTimeout(() => { tagResultsContainer.style.display = 'none'; }, 200);
    });
    tagInput.addEventListener('input', () => {
      selectedTag = null;
      const query = tagInput.value.trim();
      if (query.length < 2) {
        tagResultsContainer.style.display = 'none';
        return;
      }

      if (tagSearchTimeout) clearTimeout(tagSearchTimeout);
      tagSearchTimeout = setTimeout(async () => {
        try {
          const url = '/api/_/search/autocomplete/tags';
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const response = (await FreshdeskAPI.sendBridgeRequest(url, 'POST', { term: query })) as any;
          
          let tags = [];
          if (response && response.tags && Array.isArray(response.tags)) {
            tags = response.tags;
          } else if (Array.isArray(response)) {
            tags = response;
          }

          while (tagResultsContainer.firstChild) tagResultsContainer.removeChild(tagResultsContainer.firstChild);

          if (tags.length === 0) {
            const emptyItem = document.createElement('li');
            emptyItem.style.cssText = 'padding: 8px 12px; text-align: center; color: #999; font-size: 13px;';
            emptyItem.textContent = 'Nenhuma tag encontrada.';
            tagResultsContainer.appendChild(emptyItem);
          } else {
            for (const tag of tags.slice(0, 10)) {
              const li = document.createElement('li');
              li.style.cssText = `
                padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #f0f0f0;
                font-size: 13px; color: #333; transition: background 0.15s ease;
              `;
              
              const tagSpan = document.createElement('span');
              tagSpan.style.cssText = 'font-weight: 600; display: inline-block; background: #eef2f6; padding: 2px 6px; border-radius: 4px; border: 1px solid #dae1e8;';
              tagSpan.textContent = tag.value || 'Sem Nome';
              li.appendChild(tagSpan);

              li.addEventListener('mouseenter', () => { li.style.background = '#f0f7ff'; });
              li.addEventListener('mouseleave', () => { li.style.background = 'transparent'; });
              li.addEventListener('mousedown', (e) => {
                e.preventDefault();
                selectedTag = { id: tag.id, value: tag.value };
                tagInput.value = selectedTag.value;
                tagResultsContainer.style.display = 'none';
              });
              tagResultsContainer.appendChild(li);
            }
          }
          tagResultsContainer.style.display = 'block';
        } catch (e) {
          console.error('[Atlas Comet] Erro ao buscar tags:', e);
        }
      }, 300);
    });

    tagWrapper.appendChild(tagInput);
    tagWrapper.appendChild(tagResultsContainer);


    formContainer.appendChild(tagWrapper);

    // ═══════════════════════════════════════════════════════════════════════
    // FIELD 10: Assunto (text input)
    // ═══════════════════════════════════════════════════════════════════════
    const assuntoWrapper = document.createElement('div');
    assuntoWrapper.style.cssText = selectWrapperStyle;

    const assuntoLabel = document.createElement('label');
    assuntoLabel.style.cssText = labelStyle;
    assuntoLabel.textContent = 'Assunto';
    assuntoWrapper.appendChild(assuntoLabel);

    const assuntoInput = document.createElement('input');
    assuntoInput.type = 'text';
    assuntoInput.placeholder = 'Digite o assunto do ticket...';
    assuntoInput.style.cssText = inputStyle;
    assuntoInput.addEventListener('focus', () => {
      assuntoInput.style.borderColor = '#02ac85';
      assuntoInput.style.boxShadow = '0 0 0 3px rgba(172, 254, 223, 0.2)';
    });
    assuntoInput.addEventListener('blur', () => {
      assuntoInput.style.borderColor = '#ddd';
      assuntoInput.style.boxShadow = 'none';
    });

    assuntoWrapper.appendChild(assuntoInput);
    formContainer.appendChild(assuntoWrapper);

    // ═══════════════════════════════════════════════════════════════════════
    // FIELD 11: Descrição (textarea)
    // ═══════════════════════════════════════════════════════════════════════
    const descWrapper = document.createElement('div');
    descWrapper.style.cssText = selectWrapperStyle;

    const descLabel = document.createElement('label');
    descLabel.style.cssText = labelStyle;
    descLabel.textContent = 'Descrição';
    descWrapper.appendChild(descLabel);

    const descTextarea = document.createElement('textarea');
    descTextarea.placeholder = 'Descreva o ticket...';
    descTextarea.rows = 4;
    descTextarea.style.cssText = inputStyle + ' resize: vertical; min-height: 80px;';
    descTextarea.addEventListener('focus', () => {
      descTextarea.style.borderColor = '#02ac85';
      descTextarea.style.boxShadow = '0 0 0 3px rgba(172, 254, 223, 0.2)';
    });
    descTextarea.addEventListener('blur', () => {
      descTextarea.style.borderColor = '#ddd';
      descTextarea.style.boxShadow = 'none';
    });

    descWrapper.appendChild(descTextarea);
    formContainer.appendChild(descWrapper);

    modalBody.appendChild(formContainer);

    // ═══════════════════════════════════════════════════════════════════════
    // ACTION BUTTONS
    // ═══════════════════════════════════════════════════════════════════════
    const actionRow = document.createElement('div');
    actionRow.style.cssText =
      'display: flex; justify-content: flex-end; gap: 12px; margin-top: 16px; padding-top: 12px; border-top: 1px solid #eee;';


    const btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.style.cssText =
      'padding: 10px 20px; background: #888; color: white; border: none; cursor: pointer; border-radius: 6px; font-weight: bold; transition: background 0.2s ease;';
    btnCancel.textContent = 'Cancelar';
    btnCancel.addEventListener('mouseenter', () => { btnCancel.style.background = '#666'; });
    btnCancel.addEventListener('mouseleave', () => { btnCancel.style.background = '#888'; });
    btnCancel.onclick = () => overlay.remove();

    const btnCreate = document.createElement('button');
    btnCreate.type = 'button';
    btnCreate.style.cssText =
      'padding: 10px 24px; background: #02ac85; color: white; border: none; cursor: pointer; border-radius: 6px; font-weight: bold; transition: background 0.2s ease; display: flex; align-items: center; gap: 6px;';
    btnCreate.textContent = 'Criar novo Ticket';
    btnCreate.addEventListener('mouseenter', () => { btnCreate.style.background = '#028c6c'; });
    btnCreate.addEventListener('mouseleave', () => { btnCreate.style.background = '#02ac85'; });

    btnCreate.onclick = async () => {
      // Validate required fields
      if (!selectedContact) {
        showValidationError(contatoInput, contatoWrapper, 'Por favor, selecione um contato.');
        return;
      }
      if (!selectedService) {
        showValidationError(searchInput, servicoContainer, 'Por favor, selecione um serviço (Nível 2 ou 3).');
        return;
      }
      if (!assuntoInput.value.trim()) {
        showValidationError(assuntoInput, assuntoWrapper, 'Por favor, preencha o assunto.');
        return;
      }
      if (!descTextarea.value.trim()) {
        showValidationError(descTextarea, descWrapper, 'Por favor, preencha a descrição.');
        return;
      }
      if (!origemField.select.value) {
        showValidationError(origemField.select, origemField.wrapper, 'Por favor, selecione a origem.');
        return;
      }
      if (!tipoInput.value.trim()) {
        showValidationError(tipoInput, tipoWrapper, 'Por favor, preencha o tipo do ticket.');
        return;
      }
      if (!statusField.select.value) {
        showValidationError(statusField.select, statusField.wrapper, 'Por favor, selecione o status.');
        return;
      }
      if (!prioridadeField.select.value) {
        showValidationError(prioridadeField.select, prioridadeField.wrapper, 'Por favor, selecione a prioridade.');
        return;
      }
      if (!produtoField.select.value) {
        showValidationError(produtoField.select, produtoField.wrapper, 'Por favor, selecione o produto.');
        return;
      }

      // Show loading state
      btnCreate.textContent = 'Criando...';
      btnCreate.style.pointerEvents = 'none';
      btnCreate.style.opacity = '0.7';

      try {
        await this.executeNewTicketCreation(overlay, modalBody, {
          contato: selectedContact,
          tag: selectedTag,
          origemId: Number(origemField.select.value),
          tipo: tipoInput.value,
          service: selectedService,
          statusId: Number(statusField.select.value),
          prioridadeId: Number(prioridadeField.select.value),
          grupoId: grupoSelect.value,
          agenteId: agenteSelect.value,
          produtoId: Number(produtoField.select.value),
          assunto: assuntoInput.value.trim(),
          descricao: descTextarea.value.trim(),
        });
      } catch (e) {
        console.error('[Atlas Comet] Erro ao criar ticket:', e);
        btnCreate.textContent = 'Criar novo Ticket';
        btnCreate.style.pointerEvents = 'auto';
        btnCreate.style.opacity = '1';
      }
    };
    const btnClearPrefs = document.createElement('button');
    btnClearPrefs.type = 'button';
    btnClearPrefs.style.cssText = 'padding: 10px 20px; background: transparent; color: #d9534f; border: 1px solid #d9534f; cursor: pointer; border-radius: 6px; font-weight: bold; transition: all 0.2s ease; margin-right: auto;';
    btnClearPrefs.textContent = 'Limpar preferências';
    btnClearPrefs.addEventListener('mouseenter', () => { btnClearPrefs.style.background = '#f9ebea'; });
    btnClearPrefs.addEventListener('mouseleave', () => { btnClearPrefs.style.background = 'transparent'; });
    btnClearPrefs.onclick = () => {
      chrome.storage.local.remove([
        CONSTANTS.STORAGE.NEW_TICKET_ORIGEM,
        CONSTANTS.STORAGE.NEW_TICKET_CONTATO,
        CONSTANTS.STORAGE.NEW_TICKET_TAG,
        CONSTANTS.STORAGE.NEW_TICKET_SERVICO,
        CONSTANTS.STORAGE.NEW_TICKET_TIPO,
        CONSTANTS.STORAGE.NEW_TICKET_STATUS,
        CONSTANTS.STORAGE.NEW_TICKET_PRIORIDADE,
        CONSTANTS.STORAGE.NEW_TICKET_GRUPO,
        CONSTANTS.STORAGE.NEW_TICKET_AGENTE,
        CONSTANTS.STORAGE.NEW_TICKET_PRODUTO,
        CONSTANTS.STORAGE.NEW_TICKET_LEVEL_PREFS
      ], () => {
        contatoInput.value = '';
        selectedContact = null;
        contatoResultsContainer.style.display = 'none';

        searchInput.value = '';
        selectedService = null;
        selectedServiceBadge.style.display = 'none';
        cbN2.checked = false;
        cbN3.checked = false;
        runSearch();

        tagInput.value = '';
        selectedTag = null;
        tagResultsContainer.style.display = 'none';

        assuntoInput.value = '';
        descTextarea.value = '';
        tipoInput.value = '';

        origemField.select.value = '';
        statusField.select.value = '';
        prioridadeField.select.value = '';
        produtoField.select.value = '';

        grupoSelect.value = '';
        grupoSelect.dispatchEvent(new Event('change'));
      });
    };

    const btnRememberPrefs = document.createElement('button');
    btnRememberPrefs.type = 'button';
    btnRememberPrefs.style.cssText = 'padding: 10px 20px; background: transparent; color: #02ac85; border: 1px solid #02ac85; cursor: pointer; border-radius: 6px; font-weight: bold; transition: all 0.2s ease; margin-left: auto;';
    btnRememberPrefs.textContent = 'Lembrar preferências';
    btnRememberPrefs.addEventListener('mouseenter', () => { if (!btnRememberPrefs.dataset.saved) btnRememberPrefs.style.background = '#e6f7f3'; });
    btnRememberPrefs.addEventListener('mouseleave', () => { if (!btnRememberPrefs.dataset.saved) btnRememberPrefs.style.background = 'transparent'; });
    btnRememberPrefs.onclick = () => {
      const selectedGrupoOpt = grupoSelect.options[grupoSelect.selectedIndex];
      const selectedAgenteOpt = agenteSelect.options[agenteSelect.selectedIndex];

      chrome.storage.local.set({
        [CONSTANTS.STORAGE.NEW_TICKET_ORIGEM]: origemField.select.value || null,
        [CONSTANTS.STORAGE.NEW_TICKET_CONTATO]: selectedContact || null,
        [CONSTANTS.STORAGE.NEW_TICKET_TAG]: selectedTag || null,
        [CONSTANTS.STORAGE.NEW_TICKET_SERVICO]: selectedService || null,
        [CONSTANTS.STORAGE.NEW_TICKET_TIPO]: tipoInput.value.trim() || null,
        [CONSTANTS.STORAGE.NEW_TICKET_STATUS]: statusField.select.value || null,
        [CONSTANTS.STORAGE.NEW_TICKET_PRIORIDADE]: prioridadeField.select.value || null,
        [CONSTANTS.STORAGE.NEW_TICKET_GRUPO]: { id: grupoSelect.value || null, name: selectedGrupoOpt ? selectedGrupoOpt.textContent : '' },
        [CONSTANTS.STORAGE.NEW_TICKET_AGENTE]: { id: agenteSelect.value || null, name: selectedAgenteOpt ? selectedAgenteOpt.textContent : '' },
        [CONSTANTS.STORAGE.NEW_TICKET_PRODUTO]: produtoField.select.value || null,
        [CONSTANTS.STORAGE.NEW_TICKET_LEVEL_PREFS]: { n3: cbN3.checked, n2: cbN2.checked }
      }, () => {
        const originalText = btnRememberPrefs.textContent;
        btnRememberPrefs.dataset.saved = 'true';
        btnRememberPrefs.textContent = 'Preferências Salvas!';
        btnRememberPrefs.style.background = '#02ac85';
        btnRememberPrefs.style.color = '#fff';
        setTimeout(() => {
          delete btnRememberPrefs.dataset.saved;
          btnRememberPrefs.textContent = originalText;
          btnRememberPrefs.style.background = 'transparent';
          btnRememberPrefs.style.color = '#02ac85';
        }, 2000);
      });
    };

    actionRow.appendChild(btnClearPrefs);
    actionRow.appendChild(btnRememberPrefs);
    actionRow.appendChild(btnCancel);
    actionRow.appendChild(btnCreate);
    modalBody.appendChild(actionRow);

    // ═══════════════════════════════════════════════════════════════════════
    // LOAD SAVED PREFERENCES
    // ═══════════════════════════════════════════════════════════════════════
    if (ContextManager.isValid()) {
      // Load groups first
      this.loadGroups(grupoSelect).then(() => {
        // After groups are loaded, restore all saved preferences
        chrome.storage.local.get(
          [
            CONSTANTS.STORAGE.NEW_TICKET_ORIGEM,
            CONSTANTS.STORAGE.NEW_TICKET_CONTATO,
            CONSTANTS.STORAGE.NEW_TICKET_TAG,
            CONSTANTS.STORAGE.NEW_TICKET_SERVICO,
            CONSTANTS.STORAGE.NEW_TICKET_TIPO,
            CONSTANTS.STORAGE.NEW_TICKET_STATUS,
            CONSTANTS.STORAGE.NEW_TICKET_PRIORIDADE,
            CONSTANTS.STORAGE.NEW_TICKET_GRUPO,
            CONSTANTS.STORAGE.NEW_TICKET_AGENTE,
            CONSTANTS.STORAGE.NEW_TICKET_PRODUTO,
            CONSTANTS.STORAGE.NEW_TICKET_LEVEL_PREFS,
          ],
          (result) => {
            // Restore Origem (handles both numeric ID and legacy string label)
            const savedOrigem = result[CONSTANTS.STORAGE.NEW_TICKET_ORIGEM];
            if (savedOrigem) {
              const savedStr = String(savedOrigem);
              // Try direct value match (numeric ID as string)
              if (Array.from(origemField.select.options).some(o => o.value === savedStr)) {
                origemField.select.value = savedStr;
              } else {
                // Legacy: match by label text (old saves stored label strings)
                const match = Array.from(origemField.select.options).find(o => o.textContent === savedStr);
                if (match) origemField.select.value = match.value;
              }
            }

            // Restore Contato (stores { id, name, email })
            const savedContato = result[CONSTANTS.STORAGE.NEW_TICKET_CONTATO];
            if (savedContato && savedContato.id && savedContato.email) {
              selectedContact = {
                id: savedContato.id,
                name: savedContato.name || '',
                email: savedContato.email,
              };
              contatoInput.value = selectedContact.name
                ? `"${selectedContact.name}" <${selectedContact.email}>`
                : selectedContact.email;
            }

            // Restore Tag (stores { id, value })
            const savedTag = result[CONSTANTS.STORAGE.NEW_TICKET_TAG];
            if (savedTag && savedTag.id && savedTag.value) {
              selectedTag = {
                id: savedTag.id,
                value: savedTag.value,
              };
              tagInput.value = selectedTag.value;
            }

            // Restore Servico
            const savedServico = result[CONSTANTS.STORAGE.NEW_TICKET_SERVICO];
            if (savedServico && typeof savedServico === 'object') {
              selectedService = savedServico as { n1: string; n2: string; n3: string };
              selectedServiceBadge.textContent = `✅ Serviço selecionado: ${selectedService.n1} > ${selectedService.n2}${selectedService.n3 ? ' > ' + selectedService.n3 : ''}`;
              selectedServiceBadge.style.display = 'block';
            }

            // Restore Tipo
            const savedTipo = result[CONSTANTS.STORAGE.NEW_TICKET_TIPO];
            if (savedTipo && typeof savedTipo === 'string') tipoInput.value = savedTipo;

            // Restore Status (handles both numeric ID and legacy string label)
            const savedStatus = result[CONSTANTS.STORAGE.NEW_TICKET_STATUS];
            if (savedStatus) {
              const savedStr = String(savedStatus);
              if (Array.from(statusField.select.options).some(o => o.value === savedStr)) {
                statusField.select.value = savedStr;
              } else {
                const match = Array.from(statusField.select.options).find(o => o.textContent === savedStr);
                if (match) statusField.select.value = match.value;
              }
            }

            // Restore Prioridade (handles both numeric ID and legacy string label)
            const savedPrioridade = result[CONSTANTS.STORAGE.NEW_TICKET_PRIORIDADE];
            if (savedPrioridade) {
              const savedStr = String(savedPrioridade);
              if (Array.from(prioridadeField.select.options).some(o => o.value === savedStr)) {
                prioridadeField.select.value = savedStr;
              } else {
                const match = Array.from(prioridadeField.select.options).find(o => o.textContent === savedStr);
                if (match) prioridadeField.select.value = match.value;
              }
            }

            // Restore Grupo (and trigger agent loading)
            const savedGrupo = result[CONSTANTS.STORAGE.NEW_TICKET_GRUPO];
            if (savedGrupo && savedGrupo.id) {
              grupoSelect.value = String(savedGrupo.id);
              grupoSelect.dispatchEvent(new Event('change'));
            }

            // Restore Produto (handles both numeric ID and legacy string label)
            const savedProduto = result[CONSTANTS.STORAGE.NEW_TICKET_PRODUTO];
            if (savedProduto) {
              const savedStr = String(savedProduto);
              if (Array.from(produtoField.select.options).some(o => o.value === savedStr)) {
                produtoField.select.value = savedStr;
              } else {
                const match = Array.from(produtoField.select.options).find(o => o.textContent === savedStr);
                if (match) produtoField.select.value = match.value;
              }
            }

            // Restore level filter preferences
            const savedLevels = result[CONSTANTS.STORAGE.NEW_TICKET_LEVEL_PREFS];
            if (savedLevels && typeof savedLevels === 'object') {
              cbN3.checked = !!savedLevels.n3;
              cbN2.checked = !!savedLevels.n2;
            }

            // Run initial search after preferences are loaded
            runSearch();
          },
        );
      });
    } else {
      this.loadGroups(grupoSelect);
      runSearch();
    }
  }

  // ─── Group Loading ────────────────────────────────────────────────────────

  private static async loadGroups(grupoSelect: HTMLSelectElement): Promise<void> {
    try {
      await LookupService.init();
      const realGroups = LookupService.getAllGroups();

      while (grupoSelect.firstChild) grupoSelect.removeChild(grupoSelect.firstChild);

      const emptyOpt = document.createElement('option');
      emptyOpt.value = '';
      emptyOpt.textContent = '-- Selecionar Grupo --';
      grupoSelect.appendChild(emptyOpt);

      if (realGroups && realGroups.length > 0) {
        // Use real groups directly
        const finalGroups = [...realGroups];
        finalGroups.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        for (const group of finalGroups) {
          const opt = document.createElement('option');
          opt.setAttribute('data-name', group.name);
          opt.value = String(group.id);
          opt.textContent = group.name;
          grupoSelect.appendChild(opt);
        }
      } else {
        const errorOpt = document.createElement('option');
        errorOpt.value = '';
        errorOpt.textContent = 'Erro: Nenhum grupo encontrado';
        grupoSelect.appendChild(errorOpt);
      }
    } catch (e) {
      console.error('[Atlas Comet] Erro fatal ao carregar grupos:', e);
      while (grupoSelect.firstChild) grupoSelect.removeChild(grupoSelect.firstChild);
      const errorOpt = document.createElement('option');
      errorOpt.value = '';
      errorOpt.textContent = 'Erro ao carregar grupos';
      grupoSelect.appendChild(errorOpt);
    }
  }

  // ─── Ticket Creation Execution ────────────────────────────────────────────

  /**
   * Executes the ticket creation by filling the native Freshdesk form fields
   * programmatically and clicking the native submit button.
   *
   * Strategy:
   * 1. Uses the API bridge (POST /api/_/tickets) to create the ticket directly
   * 2. Shows a loading animation during creation
   * 3. On success, navigates to the newly created ticket
   *
   * @param overlay - The modal overlay element.
   * @param modalBody - The modal body element.
   * @param formData - All the collected form field values.
   */
  private static async executeNewTicketCreation(
    overlay: HTMLElement,
    modalBody: HTMLElement,
    formData: {
      contato: { id: number; name: string; email: string };
      tag: { id: number; value: string } | null;
      origemId: number;
      tipo: string;
      service: { n1: string; n2: string; n3: string };
      statusId: number;
      prioridadeId: number;
      grupoId: string;
      agenteId: string;
      produtoId: number;
      assunto: string;
      descricao: string;
    },
  ): Promise<void> {
    // ─── Show Loading Toast ──────────────────────────────────────────────
    while (modalBody.firstChild) modalBody.removeChild(modalBody.firstChild);
    modalBody.className = 'atlas-modal-body';
    modalBody.style.cssText += ' min-width: 360px; max-width: 420px;';

    const toastContainer = document.createElement('div');
    toastContainer.className = 'atlas-toast-container';
    toastContainer.style.cssText = 'animation: atlas-comet-fade-in 0.3s ease-out forwards;';

    const cometLoader = document.createElement('div');
    cometLoader.id = 'atlas-newticket-lottie-loader';
    cometLoader.style.cssText = 'width: 200px; height: 200px; margin: 0 auto; display: block;';

    const loadingText = document.createElement('p');
    loadingText.style.cssText =
      'color: #29735c; font-size: 15px; font-weight: 500; margin: 0; position: relative; z-index: 10;';
    loadingText.textContent = 'Criando novo ticket...';

    toastContainer.appendChild(cometLoader);
    toastContainer.appendChild(loadingText);
    modalBody.appendChild(toastContainer);

    // Initialize Lottie animation
    lottie.loadAnimation({
      container: cometLoader,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      animationData: loaderJson,
    });


    try {
      // ─── Build the API payload ────────────────────────────────────────
      // Numeric IDs are passed directly from the select values, which now
      // carry the API IDs parsed by LookupService. No hardcoded maps needed.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload: Record<string, any> = {
        subject: formData.assunto,
        description: formData.descricao,
        requester_id: formData.contato.id,
        type: formData.tipo,
        status: formData.statusId,
        priority: formData.prioridadeId,
        source: formData.origemId,
        custom_fields: {
          cf_servio_nvel_1: formData.service.n1,
          cf_servio_nvel_2: formData.service.n2,
          cf_servio_nvel_3: formData.service.n3,
        },
      };

      // Only add optional fields if set
      if (formData.grupoId) payload.group_id = Number(formData.grupoId);
      if (formData.agenteId) payload.responder_id = Number(formData.agenteId);
      if (formData.contato.email) payload.email = formData.contato.email;
      if (formData.tag) payload.tags = [formData.tag.value];

      // Product ID is already a numeric ID from LookupService
      if (formData.produtoId) {
        payload.product_id = formData.produtoId;
      }

      console.log('[Atlas Comet] New Ticket payload:', JSON.stringify(payload, null, 2));

      // ─── Create the ticket via API Bridge ──────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const createResult = (await FreshdeskAPI.createTicket(payload)) as any;

      const newTicket = createResult?.ticket || createResult?.data || createResult;
      const newTicketId = newTicket?.id || newTicket?.display_id;

      if (!newTicketId) {
        throw new Error('A API não retornou o ID do novo ticket.');
      }

      // ─── Success Toast ────────────────────────────────────────────────
      while (modalBody.firstChild) modalBody.removeChild(modalBody.firstChild);

      const successContainer = document.createElement('div');
      successContainer.style.cssText = `
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

      const successText = document.createElement('p');
      successText.style.cssText =
        'color: #29735c; font-size: 15px; font-weight: 500; margin: 0;';
      successText.textContent = `Ticket #${newTicketId} criado com sucesso! Abrindo...`;

      successContainer.appendChild(checkIcon);
      successContainer.appendChild(successText);
      modalBody.appendChild(successContainer);

      // Navigate to the new ticket
      setTimeout(() => {
        window.location.href = `/a/tickets/${newTicketId}`;
      }, 1200);
    } catch (error) {
      console.error('[Atlas Comet] Erro ao criar ticket via API:', error);

      // ─── Error Toast ──────────────────────────────────────────────────
      while (modalBody.firstChild) modalBody.removeChild(modalBody.firstChild);

      const errorContainer = document.createElement('div');
      errorContainer.style.cssText = `
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        padding: 40px 30px; text-align: center;
        animation: atlas-comet-crossfade 0.3s ease-out forwards;
      `;

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
      errorText.textContent = 'Erro ao criar ticket.';

      const errorDetail = document.createElement('pre');
      errorDetail.style.cssText =
        'color: #999; font-size: 11px; text-align: left; margin-top: 10px; white-space: pre-wrap; word-break: break-all; max-width: 100%;';
      errorDetail.textContent = error instanceof Error ? error.message : String(error);

      errorContainer.appendChild(warnIcon);
      errorContainer.appendChild(errorText);
      errorContainer.appendChild(errorDetail);
      modalBody.appendChild(errorContainer);

      setTimeout(() => overlay.remove(), 5000);
    }
  }
}


