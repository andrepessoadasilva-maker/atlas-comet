/**
 * Global Constants
 *
 * Purpose:
 * Stores all hardcoded DOM selectors, IDs, magic strings, and configuration values
 * used across the extension. This ensures easier maintenance if Freshdesk updates
 * its Ember.js application structure or class names.
 */
export const CONSTANTS = {
  // DOM IDs
  MODAL_ID: 'modal-alerta-tabulacao',
  /** ID for the New Ticket modal overlay */
  NEW_TICKET_MODAL_ID: 'atlas-comet-new-ticket-modal',

  // DOM Selectors
  SELECTORS: {
    TAG_CONTAINER: 'div[data-test-tag-input-field][data-test-id="new-ticket-tags"]',
    TAG_INPUT: 'div[data-test-tag-input-field][data-test-id="new-ticket-tags"] input',
    TAG_OPTIONS: 'li.ember-power-select-option span.tag-options',
    SUBMIT_BUTTON: 'button[type="submit"]',

    POWER_SELECT_SELECTED: '.ember-power-select-selected-item',
    /** Clickable trigger element that opens an Ember power-select dropdown, scoped by data-test-id */
    POWER_SELECT_TRIGGER: '[data-test-id="trigger-power-select"]',
    /** Portal container where Ember renders the active dropdown list items */
    DROPDOWN_WORMHOLE: '#ember-basic-dropdown-wormhole',
    /** Individual list item inside a rendered Ember power-select dropdown */
    DROPDOWN_OPTION: '.ember-power-select-option',
    /** Meta tag containing the Rails CSRF authenticity token, required for API PUT requests */
    CSRF_META: 'meta[name="csrf-token"]',
    /** Container where Freshdesk renders the "Refresh properties" link after a websocket update */
    REFRESH_BANNER: '.ticket-sidebar-sticky__refresh-text',

    // ─── New Ticket Page Selectors ──────────────────────────────────────
    /**
     * The native "Criar" submit button on the /a/tickets/new page.
     * Matches: <button data-test-id="submit" id="send-and-set" class="btn btn--primary ...">
     */
    NEW_TICKET_SUBMIT: 'button[data-test-id="submit"]#send-and-set',
    /**
     * The form container on the new ticket page that holds all input fields.
     */
    NEW_TICKET_FORM: '.new-ticket-form, .ticket-create-form, form[data-test-id="new-ticket-form"]',
  },

  // Extension Messaging Events
  EVENTS: {
    NAVIGATED: 'NAVIGATED',
  },

  // Freshdesk Specific Text Values
  VALUES: {
    NIVEL_1_TITLE: 'Serviço Nível 1',
    NIVEL_2_TITLE: 'Serviço Nível 2',
    NIVEL_3_TITLE: 'Serviço Nível 3',
    TIPO_TITLE: 'Tipo',
    CHAT_OFFLINE: 'Chat Offline',
    OFFLINE_TAG: 'atlas_comet_offline',
    BTN_UPDATE_TEXT: 'Atualizar',
    /** Default ticket type sent with API updates. Will be replaced with a UI input later. */
    DEFAULT_TICKET_TYPE: 'Dúvida de Cliente',
    /**
     * Keywords in the ticket subject that indicate a chat/conversation origin.
     * When detected (case-insensitive), the extension auto-renames the subject
     * using the existing tabulation (Tipo, N1, N2, N3) without user intervention.
     * Chat Offline tickets are explicitly excluded from this behavior.
     */
    CHAT_SUBJECT_KEYWORDS: ['CONVERSA', 'CHAT'] as readonly string[],
    /** CSS selector for the ticket subject heading element in Freshdesk's DOM */
    SUBJECT_HEADING_SELECTOR: '.ticket-subject-heading',

    // ─── New Ticket Page Defaults ─────────────────────────────────────
    /** Default value for the "Origem" field on the New Ticket form */
    DEFAULT_ORIGEM: 'Interno',
    /** Default value for the "Status" field on the New Ticket form */
    DEFAULT_STATUS: 'Aberto',
    /** Default value for the "Prioridade" field on the New Ticket form */
    DEFAULT_PRIORIDADE: 'Baixa',
    /** Default value for the "Produto" field on the New Ticket form */
    DEFAULT_PRODUTO: 'CV CRM',

    /** Status options for the New Ticket form */
    STATUS_OPTIONS: ['Aberto', 'Em atendimento', 'Pendente', 'Resolvido', 'Fechado'] as readonly string[],
    /** Priority options for the New Ticket form */
    PRIORIDADE_OPTIONS: ['Baixa', 'Média', 'Alta', 'Urgente'] as readonly string[],
    /** Product options for the New Ticket form */
    PRODUTO_OPTIONS: ['CV CRM', 'Anapro', 'Avendre'] as readonly string[],
    /** Origin options for the New Ticket form */
    ORIGEM_OPTIONS: ['Telefone', 'E-mail', 'Portal', 'Fórum', 'Chat', 'Interno', 'Observação', 'Feedback'] as readonly string[],
  },

  // Freshdesk Internal API Endpoints
  API: {
    /** Base endpoint for ticket CRUD operations via Freshdesk's internal JSON API */
    TICKETS_ENDPOINT: '/api/_/tickets',
  },

  // URL Patterns
  URL: {
    TICKETS_PATH: '/a/tickets/',
    /** Full path for the New Ticket creation form */
    NEW_TICKET_PATH: '/a/tickets/new',
    /**
     * List of host suffixes where the extension is active.
     * Used by the background script's webNavigation filter to detect SPA transitions.
     * Each entry matches the domain and all its subdomains.
     */
    ALLOWED_HOST_SUFFIXES: [
      'freshdesk.com',
      'myfreshworks.com',
      'ajuda.cvcrm.com.br',
      'ajuda.anapro.com.br',
    ] as readonly string[],
  },

  // ─── Storage Keys (New Ticket — Independent from Ticket Modal) ────────
  /**
   * Chrome.storage.local keys for persisting new ticket modal preferences.
   * These are INDEPENDENT from the ticket modal preferences to allow
   * different defaults on each screen.
   */
  STORAGE: {
    /** Saved "Origem" preference for the New Ticket modal */
    NEW_TICKET_ORIGEM: 'atlas_newticket_origem_pref',
    /** Saved "Tipo" preference for the New Ticket modal */
    NEW_TICKET_TIPO: 'atlas_newticket_tipo_pref',
    /** Saved "Status" preference for the New Ticket modal */
    NEW_TICKET_STATUS: 'atlas_newticket_status_pref',
    /** Saved "Prioridade" preference for the New Ticket modal */
    NEW_TICKET_PRIORIDADE: 'atlas_newticket_prioridade_pref',
    /** Saved "Grupo" preference for the New Ticket modal (stores { id, name }) */
    NEW_TICKET_GRUPO: 'atlas_newticket_grupo_pref',
    /** Saved "Agente" preference for the New Ticket modal (stores { id, name }) */
    NEW_TICKET_AGENTE: 'atlas_newticket_agente_pref',
    /** Saved "Produto" preference for the New Ticket modal */
    NEW_TICKET_PRODUTO: 'atlas_newticket_produto_pref',
    /** Saved service level filter preferences for the New Ticket modal */
    NEW_TICKET_LEVEL_PREFS: 'atlas_newticket_level_prefs',
  },
};


