/**
 * Atlas Comet Main-World Bridge Script
 *
 * Purpose:
 * This file is injected into Freshdesk's main JavaScript world via a <script src="...">
 * tag. It runs with full access to the page's jQuery ($), Ember, and all of Freshdesk's
 * internals — including the CSRF token that is inaccessible from the content script's
 * isolated world.
 *
 * CSRF Token Strategy:
 * Freshdesk stores the CSRF token in the response body of `/api/_/bootstrap/me`
 * at `response.meta.csrf_token`. This token is NOT in the DOM, cookies, or jQuery
 * headers — it is only available via an authenticated API call. On initialization,
 * the bridge fetches this endpoint and caches the token for subsequent PUT requests.
 *
 * Communication Protocol:
 * - Inbound:  { type: '__AUTOTAB_API_REQUEST__',  requestId, url, method, body }
 * - Outbound: { type: '__AUTOTAB_API_RESPONSE__', requestId, success, status, data?, error? }
 */
(function() {
  'use strict';

  // ─── CSRF Token Management ───────────────────────────────────────────────────

  /**
   * Cached CSRF token extracted from Freshdesk's bootstrap API.
   * Populated on first use via fetchCsrfToken().
   */
  var cachedCsrfToken = '';

  /**
   * Promise that resolves with the CSRF token once it's been fetched.
   * Ensures we only make one bootstrap request even if multiple API
   * requests arrive simultaneously.
   */
  var csrfFetchPromise = null;

  /**
   * Fetches the CSRF token from Freshdesk's bootstrap endpoint.
   *
   * The token lives at `response.meta.csrf_token` in the JSON response
   * from `/api/_/bootstrap/me`. This is the same endpoint Freshdesk's
   * own Ember app calls on page load to initialize the session.
   *
   * Returns a Promise that resolves with the token string.
   * Caches the result so subsequent calls return immediately.
   *
   * @returns {Promise<string>} The CSRF token, or empty string on failure.
   */
  function fetchCsrfToken() {
    /* Return cached token if already fetched */
    if (cachedCsrfToken) {
      return Promise.resolve(cachedCsrfToken);
    }

    /* Return existing fetch promise if already in-flight */
    if (csrfFetchPromise) {
      return csrfFetchPromise;
    }

    csrfFetchPromise = fetch('/api/_/bootstrap/me', {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        'Accept': 'application/json'
      }
    })
    .then(function(response) {
      if (!response.ok) {
        throw new Error('Bootstrap request failed: HTTP ' + response.status);
      }
      return response.json();
    })
    .then(function(data) {
      if (data && data.meta && data.meta.csrf_token) {
        cachedCsrfToken = data.meta.csrf_token;
        return cachedCsrfToken;
      }
      console.warn('[Atlas Comet Bridge] ⚠️ Bootstrap response missing meta.csrf_token');
      return '';
    })
    .catch(function(err) {
      console.error('[Atlas Comet Bridge] ❌ Failed to fetch CSRF token:', err.message);
      csrfFetchPromise = null; /* Allow retry on next attempt */
      return '';
    });

    return csrfFetchPromise;
  }

  // ─── Response Helper ─────────────────────────────────────────────────────────

  /**
   * Sends the API response back to the content script via postMessage.
   *
   * @param {string} requestId - The unique request ID for matching.
   * @param {boolean} success - Whether the request succeeded.
   * @param {number|undefined} status - HTTP status code.
   * @param {*} dataOrError - Response data (success) or error string (failure).
   */
  function sendResponse(requestId, success, status, dataOrError) {
    window.postMessage({
      type: '__AUTOTAB_API_RESPONSE__',
      requestId: requestId,
      success: success,
      status: status,
      data: success ? dataOrError : undefined,
      error: success ? undefined : dataOrError
    }, '*');
  }

  // ─── Main Message Handler ────────────────────────────────────────────────────

  /**
   * Listens for API requests from the content script.
   * When a request arrives:
   * 1. Fetches the CSRF token from the bootstrap endpoint (cached after first call)
   * 2. Makes the API request via jQuery $.ajax with the token
   * 3. Posts the result back to the content script
   */
  window.addEventListener('message', function(event) {
    if (event.origin !== window.location.origin) return;
    if (!event.data) return;

    if (event.data.type === '__AUTOTAB_API_RELOAD_TICKET__') {
      var ticketId = event.data.ticketId;
      try {
        if (typeof Ember !== 'undefined' && Ember.Application && Ember.Application.NAMESPACES) {
          var app = Ember.Application.NAMESPACES.find(function(n) { return typeof n.__container__ !== 'undefined'; });
          if (app) {
            var store = app.__container__.lookup('service:store');
            var ticket = store.peekRecord('ticket', ticketId);
            if (ticket) {
              ticket.reload();
            } else {
              console.warn('[Atlas Comet Bridge] ⚠️ Ticket model not found in store.');
            }
          } else {
            console.warn('[Atlas Comet Bridge] ⚠️ Ember container not found.');
          }
        }
      } catch (e) {
        console.error('[Atlas Comet Bridge] ❌ Failed to reload Ember model:', e);
      }
      return;
    }

    /* Only handle our specific message type */
    if (event.data.type !== '__AUTOTAB_API_REQUEST__') return;

    var requestId = event.data.requestId;
    var url = event.data.url;
    var method = event.data.method;
    var body = event.data.body;

    try {
      var parsedUrl = new URL(url, window.location.origin);
      if (!parsedUrl.pathname.match(/^(\/api\/_\/tickets\/\d+(\/update_properties)?|\/api\/(v2|_)\/ticket_fields)$/)) {
        console.error('[Atlas Comet Bridge] ❌ Unauthorized API endpoint requested:', url);
        return;
      }
      url = parsedUrl.pathname;
    } catch (e) {
      console.error('[Atlas Comet Bridge] ❌ Invalid URL format:', url);
      return;
    }

    /* GET requests typically don't need CSRF tokens in Freshdesk internal API */
    if (method === 'GET') {
      executeRequest(null);
    } else {
      fetchCsrfToken().then(function(csrfToken) {
        executeRequest(csrfToken);
      });
    }

    function executeRequest(csrfToken) {
      var headers = {};
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }

      /**
       * Use jQuery $.ajax for the request.
       * jQuery is always present in Freshdesk and handles cookie attachment
       * automatically for same-origin requests.
       */
      if (typeof $ !== 'undefined' && $.ajax) {
        $.ajax({
          url: url,
          method: method,
          contentType: 'application/json; charset=UTF-8',
          data: body ? JSON.stringify(body) : undefined,
          headers: headers,
          dataType: 'json',
          success: function(data, textStatus, xhr) {
            sendResponse(requestId, true, xhr.status, data);
          },
          error: function(xhr) {
            console.error('[Atlas Comet Bridge] ❌ Request failed:', xhr.status, xhr.responseText);
            sendResponse(requestId, false, xhr.status, 'HTTP ' + xhr.status + ': ' + (xhr.responseText || xhr.statusText));
          }
        });
      } else {
        /**
         * Fallback: native fetch.
         * Unlikely path since jQuery is always present in Freshdesk.
         */
        var fetchHeaders = {
          'Content-Type': 'application/json; charset=UTF-8',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest'
        };
        if (csrfToken) fetchHeaders['X-CSRF-Token'] = csrfToken;

        fetch(url, {
          method: method,
          headers: fetchHeaders,
          credentials: 'same-origin',
          body: body ? JSON.stringify(body) : undefined
        }).then(function(resp) {
          if (!resp.ok) {
            return resp.text().then(function(t) {
              throw { status: resp.status, message: t };
            });
          }
          return resp.json();
        }).then(function(data) {
          sendResponse(requestId, true, 200, data);
        }).catch(function(err) {
          var status = err.status || 0;
          var msg = err.message || String(err);
          sendResponse(requestId, false, status, 'HTTP ' + status + ': ' + msg);
        });
      }
    }
  });

  /**
   * Pre-fetch the CSRF token on bridge initialization so it's ready
   * when the first API request comes in. This eliminates the latency
   * of fetching the token at request time.
   */
  fetchCsrfToken();

})();
