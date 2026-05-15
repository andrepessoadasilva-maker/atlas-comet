/* eslint-disable @typescript-eslint/no-explicit-any, prefer-const, no-console, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-unused-vars */
/**
 * Context Manager Service
 *
 * Purpose:
 * Monitors the extension's runtime context to detect when it has been invalidated
 * (usually due to an update or reload). It provides a centralized check and
 * triggers a graceful shutdown of all extension logic while prompting the user
 * to reload the page.
 */
export class ContextManager {
  private static isInvalidated = false;
  private static bannerInjected = false;

  /**
   * Checks if the extension context is still valid.
   * If it detects invalidation, it triggers the shutdown sequence.
   */
  public static isValid(): boolean {
    if (this.isInvalidated) return false;

    try {
      // Accessing chrome.runtime.id is a reliable way to check context.
      // If it's undefined or throws, the context is dead.
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
        this.handleInvalidation();
        return false;
      }
      return true;
    } catch (e) {
      this.handleInvalidation();
      return false;
    }
  }

  /**
   * Global listener to catch "Extension context invalidated" errors that might
   * bubble up from async calls or chrome API events.
   */
  public static setupGlobalProtection(): void {
    const handleError = (error: any) => {
      const msg = error?.message || String(error);
      if (
        msg.includes('Extension context invalidated') ||
        msg.includes('Contexto da extensão invalidado')
      ) {
        this.handleInvalidation();
      }
    };

    window.addEventListener('error', (event) => handleError(event.error));
    window.addEventListener('unhandledrejection', (event) => handleError(event.reason));
  }

  /**
   * Triggered when the context is confirmed as invalid.
   * Ensures the extension stops doing work and notifies the user.
   */
  private static handleInvalidation(): void {
    if (this.isInvalidated) return;
    this.isInvalidated = true;

    // Use console.log instead of warn/error to avoid polluting the
    // Extension Manager's error log (chrome://extensions).
    console.log('[Atlas Comet] Contexto da extensão invalidado. Interrompendo execuções.');

    // Notify other components if needed (via event or direct call if they check isValid)
    this.injectReloadBanner();
  }

  /**
   * Injects a high-visibility, non-intrusive banner at the top of the page
   * asking the user to reload.
   */
  private static injectReloadBanner(): void {
    if (this.bannerInjected) return;
    this.bannerInjected = true;

    const banner = document.createElement('div');
    banner.id = 'atlas-comet-reload-banner';
    banner.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      background: #d93025;
      color: white;
      text-align: center;
      padding: 10px;
      z-index: 1000000;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      font-weight: 600;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 15px;
      animation: slideDown 0.3s ease-out;
    `;

    // Animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideDown {
        from { transform: translateY(-100%); }
        to { transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);

    const text = document.createElement('span');
    text.textContent = '🚀 Atlas Comet foi atualizado! Recarregue a página para continuar usando.';

    const btnReload = document.createElement('button');
    btnReload.textContent = 'Recarregar Agora';
    btnReload.style.cssText = `
      background: white;
      color: #d93025;
      border: none;
      padding: 5px 15px;
      border-radius: 4px;
      cursor: pointer;
      font-weight: bold;
      transition: opacity 0.2s;
    `;
    btnReload.onmouseenter = () => (btnReload.style.opacity = '0.9');
    btnReload.onmouseleave = () => (btnReload.style.opacity = '1');
    btnReload.onclick = () => window.location.reload();

    banner.appendChild(text);
    banner.appendChild(btnReload);
    document.body.appendChild(banner);
  }
}


