import { CONSTANTS } from './constants';

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
    // Filter to only trigger on URLs ending with freshdesk.com to save performance.
    url: [{ hostSuffix: CONSTANTS.URL.FRESHDESK_HOST_SUFFIX }],
  },
);
