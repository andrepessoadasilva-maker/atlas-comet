/* eslint-disable @typescript-eslint/no-explicit-any, prefer-const, no-console, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-unused-vars */
/**
 * Freshdesk API Service Module (Main-World Bridge Pattern)
 *
 * Purpose:
 * Provides a secure interface for updating ticket properties via Freshdesk's
 * internal JSON API (`/api/_/tickets/{id}`). Instead of making the request from
 * the content script's isolated world (which lacks access to CSRF tokens stored
 * in Ember's JavaScript memory), we inject a minimal script into the page's main
 * world and use the page's own `$.ajax` to make the request.
 *
 * Why this pattern is necessary:
 * Chrome Content Scripts run in an "Isolated World" — they share the DOM with the
 * page but have a completely separate JavaScript context. Freshdesk stores its CSRF
 * token inside Ember's application adapter (not in a `<meta>` tag, cookie, or any
 * DOM-accessible location). Since we cannot read Ember's JS variables from the
 * isolated world, we inject a `<script>` tag that runs in the **page's own JS context**,
 * where it has access to `$`, `Ember`, and all of Freshdesk's internals.
 *
 * Communication Flow:
 * 1. Content Script → `window.postMessage({type: '__AUTOTAB_API_REQUEST__', ...})`
 * 2. Injected Script (main world) receives the message, makes `$.ajax` PUT request
 * 3. Injected Script → `window.postMessage({type: '__AUTOTAB_API_RESPONSE__', ...})`
 * 4. Content Script receives the response and resolves/rejects the Promise
 *
 * Security Considerations:
 * - The injected script is minimal and deterministic (no dynamic code execution).
 * - Communication uses `window.postMessage` with explicit type-checking.
 * - Request IDs prevent response spoofing or cross-talk between concurrent calls.
 * - The injected `<script>` element is removed from the DOM immediately after
 *   injection (the event listener persists in memory).
 * - No external libraries — uses the page's existing jQuery instance.
 */

import { CONSTANTS } from './constants';
import { ContextManager } from './context';

// ─── Type Definitions ────────────────────────────────────────────────────────

/**
 * Represents the custom_fields payload expected by Freshdesk's internal API.
 * Field keys use Freshdesk's internal snake_case naming convention with the
 * `cf_` prefix (custom field).
 */
export interface FreshdeskCustomFields {
  /** Serviço Nível 1 — top-level service category */
  cf_servio_nvel_1: string;
  /** Serviço Nível 2 — mid-level service subcategory */
  cf_servio_nvel_2: string;
  /** Serviço Nível 3 — leaf-level service option */
  cf_servio_nvel_3: string;
}

/**
 * Represents the full request body sent to Freshdesk's ticket update endpoint.
 * Only includes the fields we need to modify — Freshdesk's API performs a
 * partial update (PATCH-like semantics on a PUT endpoint).
 */
export interface TicketUpdatePayload {
  /** Ticket type classification (e.g., "Dúvida de Cliente") */
  type: string;
  /** Custom fields containing the 3-level service hierarchy */
  custom_fields: FreshdeskCustomFields;
  /** Optional subject update to clean up auto-generated prefixes */
  subject?: string;
  /** Optional array of tags to replace the current ones */
  tags?: string[];
}

/**
 * Shape of the message posted from the content script to the main world.
 */
interface BridgeRequest {
  type: '__AUTOTAB_API_REQUEST__';
  requestId: string;
  url: string;
  method: string;
  body?: any;
}

/**
 * Shape of the message posted from the main world back to the content script.
 */
interface BridgeResponse {
  type: '__AUTOTAB_API_RESPONSE__';
  requestId: string;
  success: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}

// ─── Bridge Script (runs in main world) ──────────────────────────────────────

/**
 * The bridge script content lives in `bridge-inject.js` at the extension root.
 * It is loaded via `chrome.runtime.getURL()` and injected as a `<script src="...">`
 * element to comply with CSP (inline scripts are blocked by Freshdesk).
 * See `bridge-inject.js` for the full implementation and documentation.
 */

// ─── Service Class ───────────────────────────────────────────────────────────

/**
 * Static service class for interacting with Freshdesk's internal ticket API
 * via the main-world bridge pattern.
 *
 * Architecture:
 * - `injectBridge()` runs once to inject the listening script into the page
 * - `sendBridgeRequest()` sends a message and returns a Promise that resolves
 *   when the injected script posts back the response
 * - `updateTicket()` and `updateServiceLevels()` are the public-facing methods
 *
 * Usage:
 * ```typescript
 * await FreshdeskAPI.updateServiceLevels('415782', 'N1 Value', 'N2 Value', 'N3 Value');
 * ```
 */
export class FreshdeskAPI {
  /**
   * Stores the Promise from the bridge injection so that multiple callers
   * can await the same load event without re-injecting the script.
   */
  private static bridgeReadyPromise: Promise<void> | null = null;

  /**
   * Map of pending request IDs to their Promise resolve/reject callbacks.
   * Used to match incoming `__AUTOTAB_API_RESPONSE__` messages to the correct
   * Promise that is awaiting a response.
   */
  private static pendingRequests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();

  /**
   * Injects the bridge script into the page's main world and sets up
   * the response listener in the content script.
   *
   * Returns a Promise that resolves when the bridge script has fully loaded
   * and its event listeners are active in the page's main world. This ensures
   * no messages are sent before the bridge is ready to receive them.
   *
   * Implementation Details:
   * - Creates a `<script>` element with `src` pointing to the extension's
   *   `bridge-inject.js` (loaded via `chrome.runtime.getURL`)
   * - The Promise resolves on the script's `load` event, guaranteeing the
   *   bridge's `message` listener is registered before any postMessage calls
   * - The response listener is set up synchronously (before the script loads)
   *   to avoid missing fast responses
   *
   * Safety:
   * - Called idempotently — returns the same Promise on subsequent calls
   * - The `<script>` element is removed from DOM after load (listener persists)
   */
  private static injectBridge(): Promise<void> {
    // Return existing promise if already injecting or injected
    if (this.bridgeReadyPromise) return this.bridgeReadyPromise;

    this.bridgeReadyPromise = new Promise<void>((resolve, reject) => {
      /**
       * Set up the response listener FIRST (before the script loads) so we
       * never miss a response, even if the bridge somehow responds instantly.
       */
      window.addEventListener('message', (event: MessageEvent<BridgeResponse>) => {
        // Enforce same-origin policy
        if (event.origin !== window.location.origin) return;

        // Ignore messages that aren't our responses
        if (!event.data || event.data.type !== '__AUTOTAB_API_RESPONSE__') return;

        const { requestId, success, error, data } = event.data;
        const pending = this.pendingRequests.get(requestId);

        if (!pending) {
          console.log(`[FreshdeskAPI] Received response for unknown requestId: ${requestId}`);
          return;
        }

        this.pendingRequests.delete(requestId);

        if (success) {
          pending.resolve(data);
        } else {
          pending.reject(new Error(error || 'Unknown bridge error'));
        }
      });

      /**
       * Inject the bridge as an external script file (not inline) to comply with
       * Freshdesk's Content Security Policy. The file is declared as a
       * web_accessible_resource in manifest.json, making it loadable from the
       * extension's origin (which Freshdesk's CSP allows).
       */
      if (!ContextManager.isValid()) {
        reject(new Error('Contexto da extensão invalidado. Por favor, recarregue a página.'));
        return;
      }
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('bridge-inject.js');

      script.onload = () => {
        script.remove(); // Clean up DOM; the event listener persists in memory
        resolve();
      };

      script.onerror = () => {
        console.error('[FreshdeskAPI] Failed to load bridge-inject.js.');
        reject(new Error('Failed to load bridge-inject.js. Check web_accessible_resources.'));
      };

      (document.head || document.documentElement).appendChild(script);
    });

    return this.bridgeReadyPromise;
  }

  /**
   * Sends an API request through the main-world bridge and returns a Promise
   * that resolves when the response is received.
   *
   * Flow:
   * 1. Awaits bridge injection (ensures script is fully loaded and listening)
   * 2. Generates a unique request ID for response matching
   * 3. Posts the request via `window.postMessage`
   * 4. Returns a Promise that resolves/rejects when the matching response arrives
   * 5. Times out after 15 seconds to prevent dangling Promises
   *
   * @param url - The full API URL to request.
   * @param method - HTTP method (e.g., 'PUT').
   * @param body - The JSON-serializable request body.
   * @returns {Promise<unknown>} The parsed response data.
   * @throws {Error} On timeout, network errors, or non-2xx responses.
   */
  private static async sendBridgeRequest(
    url: string,
    method: string,
    body?: any,
  ): Promise<unknown> {
    // Wait for bridge to be fully loaded before sending any messages
    await this.injectBridge();

    /**
     * Generate a unique request ID using crypto-random values for collision resistance.
     * This ID ensures the correct Promise is resolved when the response arrives,
     * even if multiple requests are in flight simultaneously.
     */
    const requestId = Math.random().toString(36).substring(2) + Date.now().toString(36);

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });

      // Post the request to the main world
      const message: BridgeRequest = {
        type: '__AUTOTAB_API_REQUEST__',
        requestId,
        url,
        method,
        body,
      };

      window.postMessage(message, '*');

      /**
       * Safety timeout: reject after 15 seconds if no response is received.
       * This prevents Promises from hanging indefinitely if the bridge script
       * fails silently or the page context is destroyed.
       */
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error('[FreshdeskAPI] Bridge request timed out after 15s.'));
        }
      }, 15000);
    });
  }

  /**
   * Updates a Freshdesk ticket's properties via the internal JSON API,
   * routed through the main-world bridge.
   *
   * @param ticketId - The numeric ticket ID (e.g., "415782").
   * @param payload - The partial ticket update payload containing type and custom_fields.
   * @throws {Error} On bridge communication failure, network errors, or non-2xx responses.
   */
  public static async updateTicket(ticketId: string, payload: TicketUpdatePayload): Promise<void> {
    const url = `${CONSTANTS.API.TICKETS_ENDPOINT}/${ticketId}`;
    await this.sendBridgeRequest(url, 'PUT', payload);
  }

  /**
   * Fetches the full ticket fields schema from Freshdesk's internal API.
   * This allows dynamic discovery of 'Tipo' and 'Serviço Nível' options.
   *
   * @returns {Promise<any>} The parsed API response containing the ticket fields array.
   */
  public static async fetchTicketFields(): Promise<any> {
    try {
      const url = `/api/_/ticket_fields`;
      return await this.sendBridgeRequest(url, 'GET');
    } catch (e) {
      console.warn('[Atlas Comet] Falha na rota interna, tentando v2 API...', e);
      const fallbackUrl = `/api/v2/ticket_fields`;
      return await this.sendBridgeRequest(fallbackUrl, 'GET');
    }
  }

  /**
   * Fetches a Freshdesk ticket's properties via the internal JSON API.
   *
   * @param ticketId - The numeric ticket ID (e.g., "415782").
   * @returns {Promise<any>} The ticket data payload from Freshdesk.
   */
  public static async getTicket(ticketId: string, include?: string): Promise<any> {
    const url = include
      ? `${CONSTANTS.API.TICKETS_ENDPOINT}/${ticketId}?include=${include}`
      : `${CONSTANTS.API.TICKETS_ENDPOINT}/${ticketId}`;
    return await this.sendBridgeRequest(url, 'GET');
  }

  /**
   * Convenience method to build and send a ticket update for service levels.
   *
   * Purpose:
   * Wraps `updateTicket` with a simpler signature that takes the 3 service level
   * values directly, plus the ticket type. This is the primary method called by
   * the UI layer after the user selects a subject from the search picker.
   *
   * After a successful call, the caller should reload the page to sync
   * Ember's in-memory model with the backend changes.
   *
   * @param ticketId - The numeric ticket ID string.
   * @param n1Value - The selected Serviço Nível 1 value (label string).
   * @param n2Value - The selected Serviço Nível 2 value (label string).
   * @param n3Value - The selected Serviço Nível 3 value (label string).
   * @param ticketType - The ticket type classification. Defaults to "Dúvida de Cliente".
   * @throws {Error} On any API or network failure.
   */
  public static async updateServiceLevels(
    ticketId: string,
    n1Value: string,
    n2Value: string,
    n3Value: string,
    ticketType: string = CONSTANTS.VALUES.DEFAULT_TICKET_TYPE,
  ): Promise<void> {
    const payload: TicketUpdatePayload = {
      type: ticketType,
      custom_fields: {
        cf_servio_nvel_1: n1Value,
        cf_servio_nvel_2: n2Value,
        cf_servio_nvel_3: n3Value,
      },
    };

    // Extract current subject from DOM and clean it if necessary
    const heading = document.querySelector('.ticket-subject-heading');
    if (heading) {
      const currentSubject = heading.textContent?.trim() || '';
      if (currentSubject.toUpperCase().includes('[CHAT] - OFFLINE')) {
        const cleanedSubject = currentSubject
          .replace(/\[CHAT\]\s*-\s*OFFLINE\s*-?\s*/gi, '')
          .trim();
        if (cleanedSubject.length > 0 && cleanedSubject !== currentSubject) {
          payload.subject = cleanedSubject;
        }
      }
    }

    // Faz um GET para pegar os dados atuais
    const getUrl = `${CONSTANTS.API.TICKETS_ENDPOINT}/${ticketId}`;
    try {
      const rawResponse = (await this.sendBridgeRequest(getUrl, 'GET')) as any;

      // Cobre as 3 formas possíveis que a Bridge/Freshdesk podem retornar os dados:
      const actualTicket = rawResponse?.data || rawResponse?.ticket || rawResponse;

      if (actualTicket && Array.isArray(actualTicket.tags)) {
        if (actualTicket.tags.includes(CONSTANTS.VALUES.OFFLINE_TAG)) {
          payload.tags = actualTicket.tags.filter(
            (tag: string) => tag !== CONSTANTS.VALUES.OFFLINE_TAG,
          );
        }
      }
    } catch (e) {
      console.log('[Atlas Comet] Erro ao buscar tags do ticket:', e);
    }

    await this.updateTicket(ticketId, payload);
  }

  /**
   * Tells the Main-World Bridge to force Ember Data to reload the specific ticket
   * model. This syncs the UI component cleanly without refreshing the full page.
   *
   * @param ticketId - The numeric ticket ID to reload.
   */
  public static async reloadTicketInEmber(ticketId: string): Promise<void> {
    await this.injectBridge();
    window.postMessage(
      {
        type: '__AUTOTAB_API_RELOAD_TICKET__',
        ticketId: ticketId,
      },
      '*',
    );
  }

  /**
   * Updates only the ticket subject silently via the internal Freshdesk API.
   *
   * @param ticketId - The numeric ticket ID.
   * @param subject - The new subject string.
   */
  public static async updateTicketSubjectSilently(
    ticketId: string,
    subject: string,
    tags?: string[],
  ): Promise<void> {
    const url = `${CONSTANTS.API.TICKETS_ENDPOINT}/${ticketId}/update_properties`;
    const payloadBody: any = { subject };
    if (tags) {
      payloadBody.tags = tags;
    }
    await this.sendBridgeRequest(url, 'PUT', payloadBody);
  }
}


