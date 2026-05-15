# Antigravity Framework: Freshdesk Extension Architecture

This document provides a systematic blueprint for building a secure, scalable, and performant Manifest V3 Chrome Extension targeting Freshdesk.

## 1. Full System Overview
Freshdesk is a heavily dynamic Single Page Application (SPA), primarily built with Ember.js. Navigating between tickets (`/a/tickets/123` to `/a/tickets/124`) happens client-side without standard page unloads. 

**Core Problem with Legacy Approach:**
The original implementation relied on a global `setInterval` polling the DOM every 2 seconds. This has major drawbacks:
1. **Inefficiency:** It wastes CPU cycles when the page is idle.
2. **Race Conditions:** It could miss states while Ember is updating the virtual DOM.
3. **Memory Leaks:** If listeners aren't properly untethered during SPA transitions, state accumulates.

**The Antigravity Approach:**
We utilize an event-driven architecture relying on:
- **History API Interception / Title Observation:** To detect URL changes without polling.
- **Micro-Targeted `MutationObserver`:** To watch exactly when the UI container renders the target fields, executing our logic precisely once per valid state.

## 2. Architecture Explanation

The transition to strict TypeScript enforces robust boundary checking. We separate concerns into distinct modules (which will be bundled into a single `content.js` script to satisfy constraints).

### Components

1. **`background.ts` (Service Worker)**
   - *Role:* Manages extension lifecycle and global state (e.g., cross-tab configuration caching).
   - *Freshdesk Context:* Can listen to `chrome.webNavigation.onHistoryStateUpdated` to push a signal to the content script exactly when the SPA changes URLs, eliminating the need to poll `location.href`.

2. **`content.ts` (Content Script Entry)**
   - *Role:* Bootstraps the application inside the isolated world of the webpage.
   - *Freshdesk Context:* Holds the logic that identifies what page we are currently on.

3. **`router.ts` / `observer.ts`**
   - *Role:* Replaces the `setInterval` loop. Binds a `MutationObserver` to a stable parent element in Freshdesk (e.g., the ticket properties sidebar container).
   - *Tradeoff Resolution:* Instead of observing `document.body` (which fires thousands of times per second in an SPA, severely degrading performance), we wait for the parent container to exist, then observe only its child list.

4. **`ui.ts` (Secure UI Layer)**
   - *Role:* Replaces legacy `innerHTML` implementations. Creates modals using strictly typed `document.createElement`.

## 3. Security Model and Threat Analysis (CRITICAL)

Freshdesk displays highly untrusted data (emails from users, external subject lines, raw comments).

### Threat 1: Cross-Site Scripting (XSS) via DOM Injection
- **Vector:** The original extension injected a modal using `modal.innerHTML = "...";`. If any dynamic ticket property (like a ticket subject or ID) were ever appended to that string (e.g., `modal.innerHTML = `Ticket ${ticketId}`), it could result in standard XSS. A malicious user submitting a ticket named `<img src="x" onerror="alert(document.cookie)">` could steal the agent's session.
- **Mitigation:** We **strictly** forbid `innerHTML` and `insertAdjacentHTML`. All DOM nodes must be built via deterministic DOM APIs:
  ```typescript
  const title = document.createElement('h2');
  title.textContent = `Atenção: Ticket ${ticketId}`; // 100% Safe, parses as text only.
  ```

### Threat 2: Prototype Pollution & DOM Clobbering in Ember.js
- **Vector:** Ember.js extends native prototypes and heavily modifies the global window. An attacker could clobber DOM elements (e.g., placing an `<input id="confirm-offline">` on the page). 
- **Mitigation:** Since Chrome Content Scripts run in an **"Isolated World"**, the JavaScript variables do not conflict. However, the DOM is shared. We must scope our queries explicitly (e.g., querying inside our generated Shadow DOM or using highly specific GUID IDs) rather than trusting global `#id` tags.
- **Implementation Constraint:** Avoid `document.getElementById` for extension-generated buttons. Instead, store the created node reference directly in memory.

### Threat 3: Open Messaging Channels
- **Vector:** Dependency vulnerabilities (npm packages). 
- **Mitigation:** Adhere strictly to the *Zero External Libraries* constraint in production. 

## 4. Setup and Development Instructions

To maintain the "No external libraries" constraint while allowing for a robust TypeScript developer experience, we will use `typescript` and a minimal bundler (e.g., `esbuild` or Webpack) **exclusively as dev dependencies**. The final output is completely vanilla.

1. **Initialize & Install Dev Tools:**
   ```bash
   npm init -y
   npm install typescript @types/chrome esbuild --save-dev
   ```
2. **Configuration (`tsconfig.json`):**
   ```json
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "ESNext",
       "strict": true,
       "noImplicitAny": true,
       "moduleResolution": "node"
     }
   }
   ```
3. **Build Script (`package.json`):**
   ```json
   "scripts": {
     "build": "esbuild src/content.ts --bundle --outfile=dist/content.js"
   }
   ```
   *Justification for bundler:* Chrome extensions do not natively support ES6 target modules `import/export` well inside Content Scripts without a bundler mapping everything to a single file. `esbuild` allows us to write modular TypeScript and output a single, library-free JavaScript file.

## 5. Detailed Explanation of Code Workings

### The Event-Driven Observer

```typescript
// Example of the proposed Observer Pattern (replaces setInterval)

class TicketObserver {
  private observer: MutationObserver;
  private currentTicketId: string | null = null;

  constructor() {
    this.observer = new MutationObserver(this.handleMutations.bind(this));
  }

  public bindToEmberContainer(container: HTMLElement) {
    this.observer.observe(container, { childList: true, subtree: true });
  }

  private handleMutations(mutations: MutationRecord[]) {
    // Only parse when meaningful DOM additions occur in Freshdesk's properties panel.
    const propertiesLoaded = document.querySelector('.ember-power-select-selected-item');
    if (propertiesLoaded) {
      this.validateTicket();
    }
  }

  private validateTicket() {
    // Logic to validate state.
    // Observer is disconnected once validated to save memory.
    this.observer.disconnect(); 
  }
}
```

### The Secure UI Factory

```typescript
// Example of the proposed Secure UI (replaces innerHTML)

function createSecureModal(ticketId: string): void {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.8);z-index:9999;';

  const modalBody = document.createElement('div');
  modalBody.style.cssText = 'background:white;padding:20px;';

  const title = document.createElement('h2');
  title.textContent = `Atenção: Validação do Ticket ${ticketId}`; // Mitigates XSS

  const btnConfirm = document.createElement('button');
  btnConfirm.textContent = 'Confirmar Offline';
  btnConfirm.addEventListener('click', () => {
    overlay.remove(); // Memory-safe reference instead of document.getElementById
  });

  modalBody.appendChild(title);
  modalBody.appendChild(btnConfirm);
  overlay.appendChild(modalBody);
  document.body.appendChild(overlay);
}
```

## 6. Known Limitations and Future Improvements

1. **Ember Element Churn:** Freshdesk updates classes frequently. If the `.label-field` or `.ember-power-select-selected-item` classes change in a vendor update, the extension breaks. 
   - *Future fix:* Implement heuristic-based querying (e.g., finding text nodes that contain "Serviço Nível 2" regardless of the wrapping div tree structure).
2. **Permissions:** `activeTab` is listed in the legacy manifest, but Content Scripts on specific URLs (`https://*.freshdesk.com/*`) inherently bypass `activeTab` and require `host permissions`. We must define strict Host Permissions in Manifest V3.
3. **No Offline Queueing:** Validations occur only in the browser context. A future iteration might use background Service Workers combined with Chrome's `IndexedDB` API to log validations locally and replay them if the agent's internet connection drops.

## 7. Coding Standards and Documentation

**Mandatory Code Comments:** All code written for this extension must include detailed, fully fleshed-out comments for every section and function. 
- The comments must follow a consistent pattern that explicitly defines the purpose, inputs, and behavior of the code. 
- When updating or maintaining the codebase, developers must ensure that any sections or functions missing documentation are immediately retrofitted with comments that adhere to this standard. This helps maintain clarity in the dynamic and sometimes complex Ember.js environment.

**Version Management:** After every new feature is implemented, you MUST update the extension version in the `manifest.json` and any other relevant files. This ensures tracking of feature rollouts and provides agents with the latest updates smoothly.

## 8. Workflow and Quality Assurance (MANDATORY)

**Mandatory Commit & Push Policy:**
- Developers **MUST** perform a `git commit` and `git push` immediately after every coding session or significant feature implementation.
- This ensures work is never lost and remains synchronized with the remote repository.

**Pre-Commit Validation:**
- It is **COMPULSORY** to correct all linting errors (`npm run lint`) and TypeScript type errors (`npm run type-check`) before attempting a commit.
- The Husky "guard dog" is configured to block commits that do not pass these validations. Do not bypass these checks; fix the code instead.
