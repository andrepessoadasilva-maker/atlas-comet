# Plan: Refresh Freshdesk Ember Form via API (New Approach)

## Problem
The DOM manipulation approach proved unreliable due to Ember's dynamic rendering, race conditions, and nested dropdown dependencies. The previous working method used the API but forced a full `window.location.reload()`, resulting in bad UX.

## Goal
Update ticket data reliably using the internal API (`FreshdeskAPI`), then refresh ONLY the properties form component without reloading the full page.

## Proposed Solutions

### Approach A: Bridge Context Injection (Ember Model Reload)
Since we already use `bridge-inject.js` in the Main World to bypass CSRF protections, we can extend it to interact with Ember Data directly.
1. **API Call**: Content script sends `__AUTOTAB_API_REQUEST__` to the bridge. Bridge executes `$.ajax` PUT.
2. **Reload Command**: After success, content script sends `__AUTOTAB_API_RELOAD_TICKET__`.
3. **Ember Execution**: Bridge script looks up the Ember store:
   ```javascript
   const app = window.Ember.Application.NAMESPACES.find(n => n.__container__);
   const store = app.__container__.lookup('service:store');
   const ticket = store.peekRecord('ticket', ticketId);
   ticket.reload();
   ```
4. **Result**: Ember fetches the updated data and seamlessly re-renders the properties sidebar. No page reload.

### Approach B: Native WebSocket Refresh Observer (Hybrid)
When a ticket is updated via API, Freshdesk's backend broadcasts a WebSocket event to the frontend, which typically renders a "Refresh" link in the properties sidebar (`.ticket-sidebar-sticky__refresh-text`).
1. **API Call**: Use existing `FreshdeskAPI` update.
2. **Observation**: Attach a `MutationObserver` to `.ticket-sidebar-sticky__refresh-text`.
3. **Automated Click**: When the "Refresh" `<a>` or `<button>` appears, simulate a click event on it.
4. **Result**: Freshdesk natively refetches the properties.

### Approach C: Global Ticket Refresh Button Click
Freshdesk provides a native "Refresh" icon in the ticket properties sidebar or global toolbar.
1. **API Call**: Use existing `FreshdeskAPI` update.
2. **Wait & Click**: Wait 500ms for backend consistency, then query the native refresh button (`.ticket-sidebar-sticky__refresh-text` parent or global refresh icon) and execute `.click()`.
3. **Result**: Triggers Freshdesk's native partial update flow.

## Execution Recommendation
Implement **Approach B** as the primary strategy. 
- Relies on Freshdesk's own WebSocket state synchronization.
- Avoids brittle internal Ember `__container__` lookups (Approach A).
- Keeps data mutation on the robust API, but forces UI sync natively.
- Safer than guessing if data is ready like Approach C.
