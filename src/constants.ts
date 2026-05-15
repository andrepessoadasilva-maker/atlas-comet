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
  },

  // Freshdesk Internal API Endpoints
  API: {
    /** Base endpoint for ticket CRUD operations via Freshdesk's internal JSON API */
    TICKETS_ENDPOINT: '/api/_/tickets',
  },

  // URL Patterns
  URL: {
    TICKETS_PATH: '/a/tickets/',
    FRESHDESK_HOST_SUFFIX: 'freshdesk.com',
  },
};


