import { CONSTANTS } from './constants';

// Disable all console logs for production
const noop = () => {};
console.log = noop;
console.info = noop;
console.warn = noop;
console.error = noop;
console.debug = noop;

/**
 * Listen to changes in the browser history state (History API pushState/replaceState).
 *
 * Why we send messages for ALL Freshdesk URLs (not just /a/tickets/):
 * Freshdesk is a SPA — navigating from a ticket page to a dashboard or search view
 * happens client-side without a page reload. If we only send messages for ticket URLs,
 * the content script never learns that the user LEFT the ticket page, causing the
 * observer and UI buttons to persist on non-ticket views (dashboards, filters, etc.)
 * and triggering 404 API errors against non-existent ticket IDs.
 */
chrome.webNavigation.onHistoryStateUpdated.addListener(
  (details) => {
    // Notify the content script of every SPA navigation so it can
    // activate on ticket pages and clean up on non-ticket pages.
    chrome.tabs
      .sendMessage(details.tabId, {
        type: CONSTANTS.EVENTS.NAVIGATED,
        url: details.url,
      })
      .catch(() => {
        // Failure to send usually means the content script has not fully initialized yet.
        // This is expected on hard reloads; the content script will read the URL upon its own initialization.
      });
  },
  {
    // Filter to only trigger on URLs matching our supported Freshdesk domains.
    // Each host suffix is mapped to a separate URLFilter entry, so the listener
    // fires for any of the configured domains (freshdesk.com, ajuda.cvcrm.com.br, etc.)
    url: CONSTANTS.URL.ALLOWED_HOST_SUFFIXES.map((suffix) => ({ hostSuffix: suffix })),
  },
);

// ─── Cross-Origin Fetch Proxy ─────────────────────────────────────────────
// Content scripts are bound to the page's origin for fetch requests (CORS).
// The background service worker, however, can fetch any URL for which the
// extension has host_permissions (freshdesk.com, myfreshworks.com, etc.).
//
// This handler allows content scripts to request a URL fetch via:
//   chrome.runtime.sendMessage({ type: 'FETCH_URL', url: '...' }, callback)
//
// Used by Layer 7 (Team Inbox company resolution) to fetch the Team Inbox
// page from myfreshworks.com while the content script runs on freshdesk.com.
chrome.runtime.onMessage.addListener(
  (
    message: { type: string; url?: string },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: { success: boolean; data?: string; error?: string }) => void,
  ) => {
    if (message.type === 'FETCH_URL' && message.url) {
      fetch(message.url, {
        credentials: 'include',
        headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      })
        .then((res) => res.text())
        .then((text) => sendResponse({ success: true, data: text }))
        .catch((err) => sendResponse({ success: false, error: String(err) }));

      // Return true to indicate we will call sendResponse asynchronously.
      // Without this, Chrome closes the message channel immediately.
      return true;
    }
    // For other message types, return undefined (synchronous, no response needed)
    return undefined;
  },
);
