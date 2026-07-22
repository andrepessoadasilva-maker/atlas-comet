/**
 * Lookup Service Module
 *
 * Purpose:
 * Provides a strongly-typed interface for querying ALL dynamically fetched
 * Freshdesk ticket fields — including Serviço Nível hierarchy, Tipo, Grupo,
 * Origem (Source), Status, Prioridade (Priority), and Produto (Product).
 *
 * Architecture:
 * All data is sourced from a single API call to `GET /api/v2/ticket_fields`.
 * The response contains every field definition with its valid choices and IDs.
 * This module parses, caches (12h TTL via chrome.storage.local), and exposes
 * type-safe getters for each field. By centralizing field data here, we
 * eliminate hardcoded option lists throughout the codebase.
 */

import { FreshdeskAPI } from './api';
import { ContextManager } from './context';
import { CONSTANTS } from './constants';

// ─── Type Definitions ────────────────────────────────────────────────────────

export interface LookupParent {
  label: string;
  value: string;
  choiceId: number;
  level: number;
}

export interface LookupEntry {
  label: string;
  value: string;
  choiceId: number;
  level: number;
  isLeaf: boolean;
  parents: LookupParent[];
}

export interface TipoEntry {
  label: string;
  value: string;
  id: number;
  choice_id?: number;
}

/**
 * Represents a single choice option for a standard Freshdesk field
 * (Source, Status, Priority, Product). Contains both the human-readable
 * label and the numeric ID required by the Freshdesk API.
 *
 * Used by:
 * - NewTicketUIFactory to populate dropdown <select> elements dynamically
 * - Ticket creation payload builder to send correct numeric IDs
 */
export interface FieldChoice {
  /** Human-readable label as shown in Freshdesk's UI (e.g., "Interno", "Aberto") */
  label: string;
  /** Numeric ID expected by the Freshdesk API (e.g., 100 for Interno, 2 for Aberto) */
  value: number;
}

// ─── Internal State ──────────────────────────────────────────────────────────

let lookupMap: Map<number, LookupEntry> = new Map();
let tipoList: TipoEntry[] = [];
let groupList: { id: number; name: string }[] = [];

/**
 * Dynamically parsed field choices from the Freshdesk ticket_fields API.
 * These replace the previously hardcoded arrays in constants.ts, ensuring
 * the extension always reflects the actual Freshdesk configuration.
 */
let sourceList: FieldChoice[] = [];   // Origem (Source)
let statusList: FieldChoice[] = [];   // Status
let priorityList: FieldChoice[] = []; // Prioridade (Priority)
let productList: FieldChoice[] = [];  // Produto (Product)

let isInitialized = false;
let initPromise: Promise<void> | null = null;

// ─── Cache Payload Type ───────────────────────────────────────────────────────

/**
 * Represents the full shape of the v3 cache payload stored in chrome.storage.local.
 * V3 adds sources, statuses, priorities, and products to the existing v2 schema.
 * The optional markers (?) ensure backwards compatibility with stale v2 caches.
 */
interface CachePayload {
  timestamp: number;
  lookup: [number, LookupEntry][];
  tipos: TipoEntry[];
  groups: { id: number; name: string }[];
  sources?: FieldChoice[];
  statuses?: FieldChoice[];
  priorities?: FieldChoice[];
  products?: FieldChoice[];
}

// ─── Service Class ─────────────────────────────────────────────────────────────

export class LookupService {
  private static readonly MAX_RESULTS = 15;
  private static cachedLeaves: LookupEntry[] | null = null;

  public static getAllTipos(): TipoEntry[] {
    return tipoList;
  }

  public static getAllGroups(): { id: number; name: string }[] {
    if (groupList.length > 0) return groupList;

    // Fallback: Tenta extrair do select nativo se estiver na página
    const domGroups: { id: number; name: string }[] = [];
    const select = document.querySelector('select[name="helpdesk_ticket[group_id]"], select#helpdesk_ticket_group_id, select.group_id');
    if (select && select instanceof HTMLSelectElement) {
      console.log('[Atlas Comet] Grupos extraídos via DOM select fallback');
      for (const opt of Array.from(select.options)) {
        if (opt.value && opt.value.trim() !== '') {
          domGroups.push({ id: Number(opt.value), name: opt.textContent?.trim() || `Grupo #${opt.value}` });
        }
      }
    }
    return domGroups;
  }

  // ─── Dynamic Field Getters ──────────────────────────────────────────────────
  // These return choices parsed from the Freshdesk API, replacing hardcoded arrays.

  /**
   * Returns all available Source (Origem) choices from the Freshdesk API.
   * Each entry contains a human-readable label and the numeric API ID.
   * Example: [{ label: 'Interno', value: 100 }, { label: 'Telefone', value: 3 }]
   */
  public static getSources(): FieldChoice[] {
    return sourceList;
  }

  /**
   * Returns all available Status choices from the Freshdesk API.
   * Example: [{ label: 'Aberto', value: 2 }, { label: 'Pendente', value: 3 }]
   */
  public static getStatuses(): FieldChoice[] {
    return statusList;
  }

  /**
   * Returns all available Priority (Prioridade) choices from the Freshdesk API.
   * Example: [{ label: 'Baixa', value: 1 }, { label: 'Média', value: 2 }]
   */
  public static getPriorities(): FieldChoice[] {
    return priorityList;
  }

  /**
   * Returns all available Product (Produto) choices from the Freshdesk API.
   * Each entry contains the product name and its numeric ID.
   * Example: [{ label: 'CV CRM', value: 42 }]
   */
  public static getProducts(): FieldChoice[] {
    return productList;
  }

  /**
   * Initializes the LookupService by loading fields from local cache or
   * fetching them from the Freshdesk API.
   */
  public static async init(force = false): Promise<void> {
    if (isInitialized && !force) return;
    if (initPromise && !force) return initPromise;

    initPromise = (async () => {
      try {
        if (!force) {
          const cached = (await this.getFromCache()) as CachePayload | null;
          if (cached && !this.isCacheExpired(cached.timestamp)) {
            this.buildMapFromCache(
              cached.lookup, cached.tipos, cached.groups || [],
              cached.sources, cached.statuses, cached.priorities, cached.products,
            );
            isInitialized = true;
            return;
          }
        }

        console.log(
          `[Atlas Comet] ${force ? 'Sincronização forçada' : 'Cache vazio ou expirado'}. Buscando campos na API...`,
        );
        const fields = await FreshdeskAPI.fetchTicketFields();
        this.parseFields(fields);

        await this.saveToCache();
        isInitialized = true;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[Atlas Comet] Erro ao inicializar LookupService:', error);
        const cached = (await this.getFromCache()) as CachePayload | null;
        if (cached) {
          // eslint-disable-next-line no-console
          console.log('[Atlas Comet] Usando cache expirado devido a falha na API.');
          this.buildMapFromCache(
            cached.lookup, cached.tipos, cached.groups || [],
            cached.sources, cached.statuses, cached.priorities, cached.products,
          );
          isInitialized = true;
        } else {
          throw error;
        }
      } finally {
        initPromise = null;
      }
    })();

    return initPromise;
  }

  public static async getLastSyncTime(): Promise<number | null> {
    const cached = (await this.getFromCache()) as { timestamp: number } | null;
    return cached ? cached.timestamp : null;
  }

  private static parseFields(response: unknown): void {
    lookupMap.clear();
    tipoList = [];
    groupList = [];
    sourceList = [];
    statusList = [];
    priorityList = [];
    productList = [];
    this.cachedLeaves = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fieldsArray: any[] = [];
    if (Array.isArray(response)) {
      fieldsArray = response;
    } else if (response && typeof response === 'object' && 'ticket_fields' in response) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fieldsArray = (response as { ticket_fields: any[] }).ticket_fields;
    }

    if (!fieldsArray || fieldsArray.length === 0) {
      throw new Error('Formato de campos inválido retornado pela API');
    }

    // ─── 1. Parse Tipo do Ticket ──────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tipoField = fieldsArray.find((f: any) => f.name === 'ticket_type' || f.label === 'Tipo');
    if (tipoField && tipoField.choices) {
      const choices = Array.isArray(tipoField.choices)
        ? tipoField.choices
        : Object.values(tipoField.choices);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const c of choices as any[]) {
        // Freshdesk might return simple strings or objects
        if (typeof c === 'string') {
          tipoList.push({ label: c, value: c, id: 0 });
        } else {
          tipoList.push({
            label: c.value || c.label,
            value: c.value || c.label,
            id: c.id || 0,
            choice_id: c.id || 0,
          });
        }
      }
    }

    // ─── 2. Parse Groups ──────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const groupField = fieldsArray.find((f: any) => f.name === 'group_id' || f.name === 'group');
    if (groupField && groupField.choices) {
      console.log('[Atlas Comet] Estrutura do groupField:', groupField);
      
      const choices = groupField.choices;
      
      if (Array.isArray(choices)) {
        for (const c of choices) {
          if (Array.isArray(c) && c.length >= 2) {
            // Format: [["Support", 1234], ["Sales", 5678]]
            const name = typeof c[0] === 'string' ? c[0] : String(c[0]);
            const id = typeof c[1] === 'number' ? c[1] : parseInt(String(c[1]), 10);
            if (id) groupList.push({ id, name });
          } else if (c && typeof c === 'object') {
            // Format: [{"id": 1234, "value": "Support"}]
            const id = c.id || c.value || c.choice_id;
            const name = c.value || c.label || c.name || `Grupo #${id}`;
            if (id) groupList.push({ id: Number(id), name: String(name) });
          }
        }
      } else if (typeof choices === 'object') {
        // Format: {"Support": 1234, "Sales": 5678}
        for (const [key, val] of Object.entries(choices)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const id = typeof val === 'number' ? val : (val as any).id || parseInt(String(val), 10);
          if (id) groupList.push({ id, name: key });
        }
      }
    }

    // ─── 3. Parse Standard Fields (Source, Status, Priority, Product) ─────
    // These fields follow Freshdesk's standard choice format. The API can
    // return choices in MANY layouts depending on version and custom config:
    //   A) { "Label": id }                       — label→id object
    //   B) { "id": "Label" }                     — id→label inverted object
    //   C) [["label", id], ...]                   — tuple arrays (label first)
    //   C') [[id, "label"], ...]                  — tuple arrays (id first)
    //   D) [{ value: "label", id }, ...]          — object arrays
    //   E) { "id": ["Label", ...], ... }          — id→array inverted object
    //   F) { "id": { name: "Label" }, ... }       — id→object inverted object

    /**
     * Translation map for Freshdesk field labels from English to Portuguese.
     * Applied as post-processing after parsing to ensure the UI always shows
     * labels in Portuguese regardless of the API locale. Keys are lowercase
     * English labels; values are the Portuguese translations.
     */
    const EN_TO_PT_LABELS: Record<string, string> = {
      // Priority labels
      'low': 'Baixa',
      'medium': 'Média',
      'high': 'Alta',
      'urgent': 'Urgente',
      // Status labels
      'open': 'Aberto',
      'pending': 'Pendente',
      'resolved': 'Resolvido',
      'closed': 'Fechado',
      'being processed': 'Em atendimento',
      'waiting on customer': 'Aguardando Cliente',
      'waiting on third party': 'Aguardando Terceiro',
    };

    /**
     * Translates a field label from English to Portuguese using the
     * EN_TO_PT_LABELS map. If no translation is found, returns the
     * original label unchanged (preserves custom statuses that are
     * already in Portuguese or have no standard translation).
     */
    const translateLabel = (label: string): string => {
      return EN_TO_PT_LABELS[label.toLowerCase()] || label;
    };

    /**
     * Generic parser for Freshdesk field choices. Handles ALL known formats
     * returned by the V1 and V2 APIs including edge cases with custom fields.
     *
     * For tuple arrays, auto-detects whether the tuple is [label, id] or
     * [id, label] by checking which element is numeric. This eliminates a
     * major cause of silent parse failures.
     *
     * @param choices - The raw choices data from the API field definition.
     * @returns Array of FieldChoice with label and numeric value.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parseStandardChoices = (choices: any): FieldChoice[] => {
      const result: FieldChoice[] = [];

      if (Array.isArray(choices)) {
        for (const c of choices) {
          if (Array.isArray(c) && c.length >= 2) {
            // Format C/C': Tuple array — auto-detect element order.
            // Standard: ["Aberto", 2]  →  first=string, second=number
            // Inverted: [2, "Aberto"]  →  first=number, second=string
            const first = c[0];
            const second = c[1];

            if (typeof first === 'number' && typeof second === 'string') {
              // Inverted tuple: [id, label]
              result.push({ label: second, value: first });
            } else if (typeof first === 'string' && typeof second === 'number') {
              // Standard tuple: [label, id]
              result.push({ label: first, value: second });
            } else {
              // Both strings or both numbers — try to parse intelligently
              const firstNum = parseInt(String(first), 10);
              const secondNum = parseInt(String(second), 10);
              if (!isNaN(secondNum) && isNaN(firstNum)) {
                result.push({ label: String(first), value: secondNum });
              } else if (!isNaN(firstNum) && isNaN(secondNum)) {
                result.push({ label: String(second), value: firstNum });
              } else {
                // Last resort: treat first as label, try to parse second
                result.push({ label: String(first), value: secondNum || 0 });
              }
            }
          } else if (c && typeof c === 'object') {
            // Format D: [{ value: "Aberto", id: 2 }] or [{ label: "Aberto", id: 2 }]
            const label = c.value || c.label || c.name || c.title || '';
            const id = c.id || c.choice_id || c.position || 0;
            if (label && id) result.push({ label: String(label), value: Number(id) });
          } else if (typeof c === 'string') {
            // Simple string array — no IDs available
            result.push({ label: c, value: 0 });
          } else if (typeof c === 'number') {
            // Numeric-only array (unlikely but handled for safety)
            result.push({ label: String(c), value: c });
          }
        }
      } else if (choices && typeof choices === 'object') {
        for (const [key, val] of Object.entries(choices)) {
          const keyAsNumber = parseInt(key, 10);
          const valAsNumber = typeof val === 'number' ? val : parseInt(String(val), 10);

          if (!isNaN(keyAsNumber) && typeof val === 'string') {
            // Format B: { "2": "Open", "3": "Pending" } — inverted id→label
            result.push({ label: String(val), value: keyAsNumber });
          } else if (!isNaN(keyAsNumber) && Array.isArray(val) && val.length >= 1) {
            // Format E: { "2": ["Open"], "3": ["Pending", "extra"] }
            // Use the first string element as label
            const firstString = val.find((v: unknown) => typeof v === 'string');
            result.push({ label: String(firstString || val[0]), value: keyAsNumber });
          } else if (!isNaN(keyAsNumber) && val && typeof val === 'object' && !Array.isArray(val)) {
            // Format F: { "2": { name: "Open", ... } }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const obj = val as any;
            const label = obj.name || obj.label || obj.value || obj.title || '';
            if (label) result.push({ label: String(label), value: keyAsNumber });
          } else if (key && !isNaN(valAsNumber)) {
            // Format A: { "Aberto": 2, "Pendente": 3 } — label→id
            result.push({ label: key, value: valAsNumber });
          }
        }
      }

      // Filter out entries with NaN values (malformed data)
      return result.filter((c) => !isNaN(c.value));
    };

    // Parse Source (Origem) field
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sourceField = fieldsArray.find((f: any) => f.name === 'source' || f.label === 'Origem');
    if (sourceField && sourceField.choices) {
      sourceList = parseStandardChoices(sourceField.choices);
      console.log(`[Atlas Comet] Origem: ${sourceList.length} opções parseadas da API`);
    }

    // ─── Parse Status field ──────────────────────────────────────────────────
    // Uses multiple search strategies to locate the status field in the API response:
    //   1. By name: 'status'
    //   2. By label: 'Status'
    //   3. By type: 'default_status' (Freshdesk-specific field type identifier)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const statusField = fieldsArray.find((f: any) =>
      f.name === 'status' || f.label === 'Status' || f.type === 'default_status',
    );
    if (statusField) {
      // Debug: dump the raw field structure so we can diagnose format issues
      console.log('[Atlas Comet] Raw statusField found:', JSON.stringify(statusField, null, 2));

      // Try primary choices first
      if (statusField.choices) {
        statusList = parseStandardChoices(statusField.choices).map((c) => ({
          ...c,
          label: translateLabel(c.label),
        }));
      }

      // If primary parsing yielded nothing, try alternate choice locations
      // Some Freshdesk API versions nest choices under sub-keys
      if (statusList.length === 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const altChoices = statusField.statuses || statusField.options ||
          (statusField.field && statusField.field.choices) || null;
        if (altChoices) {
          console.log('[Atlas Comet] Trying alternate choice key for status...');
          statusList = parseStandardChoices(altChoices).map((c) => ({
            ...c,
            label: translateLabel(c.label),
          }));
        }
      }

      console.log(`[Atlas Comet] Status: ${statusList.length} opções parseadas da API`, statusList);
    } else {
      console.warn(
        '[Atlas Comet] Status field NOT found in API response.',
        'Searched: name="status", label="Status", type="default_status".',
        'Available fields:', fieldsArray.map((f: { name: string; label: string; type: string }) => `${f.name}(${f.type})`).join(', '),
      );
    }

    // ─── Hardcoded fallback (LAST RESORT) ────────────────────────────────────
    // Only used when the API did not return parseable status choices.
    // This ensures the modal always has options, but the IDs may be inaccurate
    // if the Freshdesk instance has been reconfigured. A console warning alerts
    // developers that the dynamic source failed and needs investigation.
    if (statusList.length === 0) {
      console.warn(
        '[Atlas Comet] ⚠️ FALLBACK ATIVADO: Status list vazia após todas as tentativas de parse.',
        'Usando lista hardcoded. Verifique o log acima para diagnosticar o formato da API.',
      );
      statusList = CONSTANTS.VALUES.FALLBACK_STATUSES.map((s) => ({ label: s.label, value: s.value }));
    }

    // Parse Priority (Prioridade) field — apply EN→PT translation to labels
    // since the V2 API returns English labels ("Low", "Medium", etc.)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const priorityField = fieldsArray.find((f: any) => f.name === 'priority' || f.label === 'Prioridade');
    if (priorityField && priorityField.choices) {
      priorityList = parseStandardChoices(priorityField.choices).map((c) => ({
        ...c,
        label: translateLabel(c.label),
      }));
      console.log(`[Atlas Comet] Prioridade: ${priorityList.length} opções parseadas da API`, priorityList);
    }

    // Parse Product (Produto) field
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const productField = fieldsArray.find((f: any) => f.name === 'product_id' || f.name === 'product' || f.label === 'Produto');
    if (productField && productField.choices) {
      productList = parseStandardChoices(productField.choices);
      console.log(`[Atlas Comet] Produto: ${productList.length} opções parseadas da API`);
    }

    // ─── 4. Parse Serviço Nível (Hierarchical) ────────────────────────────
    // Freshdesk uses nested dictionaries/arrays for hierarchical custom fields
    const servicoField = fieldsArray.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (f: any) =>
        f.type === 'nested_field' &&
        (f.name === 'custom_fields' || f.label?.toLowerCase().includes('serviço')),
    );
    if (servicoField && servicoField.choices) {
      let autoId = 10000; // Generate IDs since Freshdesk nested dictionaries lack IDs

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parseHierarchy = (choicesData: any, level: number, parents: LookupParent[]): void => {
        if (!choicesData) return;

        // Handle Array of strings or objects (usually Leaf nodes)
        if (Array.isArray(choicesData)) {
          for (const c of choicesData) {
            const label = typeof c === 'string' ? c : c.value || c.label;
            if (!label) continue;

            const id = typeof c === 'string' ? ++autoId : c.id || ++autoId;
            const subChoices = typeof c === 'object' ? c.choices : null;

            const hasChildren =
              subChoices &&
              (Array.isArray(subChoices)
                ? subChoices.length > 0
                : Object.keys(subChoices).length > 0);
            const isLeaf = !hasChildren;

            const entry: LookupEntry = {
              label: label,
              value: label,
              choiceId: id,
              level: level,
              isLeaf: isLeaf,
              parents: [...parents],
            };

            lookupMap.set(id, entry);

            if (hasChildren) {
              const newParent: LookupParent = { label, value: label, choiceId: id, level };
              parseHierarchy(subChoices, level + 1, [newParent, ...parents]);
            }
          }
        }
        // Handle Object representing tree: { "Hardware": { "Laptop": ["Mac"] } }
        else if (typeof choicesData === 'object') {
          for (const [key, value] of Object.entries(choicesData)) {
            if (!key) continue;

            const label = key;
            const id = ++autoId;

            const subChoices = value;
            const hasChildren =
              subChoices && typeof subChoices === 'object' && Object.keys(subChoices).length > 0;
            const isLeaf = !hasChildren;

            const entry: LookupEntry = {
              label: label,
              value: label,
              choiceId: id,
              level: level,
              isLeaf: isLeaf,
              parents: [...parents],
            };

            lookupMap.set(id, entry);

            if (hasChildren) {
              const newParent: LookupParent = { label, value: label, choiceId: id, level };
              parseHierarchy(subChoices, level + 1, [newParent, ...parents]);
            }
          }
        }
      };

      parseHierarchy(servicoField.choices, 1, []);
    }
  }

  // ─── Cache Management ────────────────────────────────────────────────────────
  //
  // Cache version v4 — bumped to force re-fetch after fixing the status parser.
  // v3 caches may contain empty statusList due to a parser bug. By changing the
  // cache key, all clients will discard the stale v3 cache and re-fetch from
  // the API on next init(), allowing the improved parser to populate statuses.

  /** Storage key for the unified fields cache (v4 — forced re-fetch for status fix) */
  private static readonly CACHE_KEY = 'atlas_fields_cache_v4';

  private static async getFromCache(): Promise<unknown> {
    return new Promise((resolve) => {
      if (!ContextManager.isValid()) {
        resolve(null);
        return;
      }
      chrome.storage.local.get(this.CACHE_KEY, (res) => {
        resolve(res[this.CACHE_KEY] || null);
      });
    });
  }

  private static async saveToCache(): Promise<void> {
    if (!ContextManager.isValid()) {
      return Promise.resolve();
    }
    const lookupArray = Array.from(lookupMap.entries());
    const cacheData = {
      timestamp: Date.now(),
      lookup: lookupArray,
      tipos: tipoList,
      groups: groupList,
      sources: sourceList,
      statuses: statusList,
      priorities: priorityList,
      products: productList,
    };
    return new Promise((resolve) => {
      chrome.storage.local.set({ [this.CACHE_KEY]: cacheData }, resolve);
    });
  }

  private static isCacheExpired(timestamp: number): boolean {
    const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
    return Date.now() - timestamp > CACHE_TTL_MS;
  }

  /**
   * Rebuilds all internal state from a previously cached payload.
   * Handles both v2 caches (missing new fields) and v3 caches (complete).
   */
  private static buildMapFromCache(
    cachedLookup: [number, LookupEntry][],
    cachedTipos: TipoEntry[],
    cachedGroups: { id: number; name: string }[],
    cachedSources?: FieldChoice[],
    cachedStatuses?: FieldChoice[],
    cachedPriorities?: FieldChoice[],
    cachedProducts?: FieldChoice[],
  ): void {
    lookupMap = new Map(cachedLookup);
    tipoList = cachedTipos || [];
    groupList = cachedGroups || [];
    sourceList = cachedSources || [];
    statusList = cachedStatuses || [];
    priorityList = cachedPriorities || [];
    productList = cachedProducts || [];
    this.cachedLeaves = null;

    // Apply fallback if cached statuses were empty (previous failed parse)
    if (statusList.length === 0) {
      console.warn('[Atlas Comet] Cached statuses empty. Applying hardcoded fallback.');
      statusList = CONSTANTS.VALUES.FALLBACK_STATUSES.map((s) => ({ label: s.label, value: s.value }));
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  public static getTipos(): TipoEntry[] {
    return tipoList;
  }

  public static getLeafEntries(): LookupEntry[] {
    if (!this.cachedLeaves) {
      this.cachedLeaves = [];
      for (const entry of lookupMap.values()) {
        if (entry.isLeaf) {
          this.cachedLeaves.push(entry);
        }
      }
    }
    return this.cachedLeaves;
  }

  public static getParentChain(choiceId: number): LookupEntry[] {
    const entry = lookupMap.get(choiceId);
    if (!entry) {
      // eslint-disable-next-line no-console
      console.log(`[Atlas Comet] LookupService: Entry with choiceId ${choiceId} not found.`);
      return [];
    }

    const chain: LookupEntry[] = [];
    const sortedParents = [...(entry.parents || [])].sort((a, b) => a.level - b.level);

    for (const parent of sortedParents) {
      chain.push({
        label: parent.label,
        value: parent.value,
        choiceId: parent.choiceId,
        level: parent.level,
        isLeaf: false,
        parents: [],
      });
    }

    chain.push(entry);
    return chain;
  }

  private static normalizeText(text: string): string {
    if (!text) return '';
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/-/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .toLowerCase()
      .trim();
  }

  public static searchLeaves(query: string, allowedLevels?: Set<number>): LookupEntry[] {
    let leaves = this.getLeafEntries();

    if (allowedLevels && allowedLevels.size > 0) {
      leaves = leaves.filter((leaf) => allowedLevels.has(leaf.level));
    }

    if (!query.trim()) {
      return leaves.slice(0, this.MAX_RESULTS);
    }

    const normalizedQuery = this.normalizeText(query);
    const tokens = normalizedQuery.split(/\s+/).filter((t) => t.length > 0);

    if (tokens.length === 0) {
      return leaves.slice(0, this.MAX_RESULTS);
    }

    const scoredResults: { entry: LookupEntry; score: number }[] = [];

    for (const leaf of leaves) {
      const normalizedLabel = this.normalizeText(leaf.label);
      const parentLabels = (leaf.parents || []).map((p) => this.normalizeText(p.label)).join(' ');
      const fullSearchText = `${normalizedLabel} ${parentLabels}`;

      let score = 0;

      if (normalizedLabel.startsWith(normalizedQuery)) {
        score = 1;
      } else if (tokens.every((token) => fullSearchText.includes(token))) {
        score = 2;
      } else if (tokens.some((token) => fullSearchText.includes(token))) {
        score = 3;
      }

      if (score > 0) {
        scoredResults.push({ entry: leaf, score });
      }
    }

    scoredResults.sort((a, b) => {
      if (a.score !== b.score) {
        return a.score - b.score;
      }
      return a.entry.label.localeCompare(b.entry.label);
    });

    return scoredResults.slice(0, this.MAX_RESULTS).map((r) => r.entry);
  }

  public static getBreadcrumb(entry: LookupEntry): string {
    const sortedParents = [...(entry.parents || [])].sort((a, b) => a.level - b.level);
    return sortedParents.map((p) => p.label).join(' > ');
  }
}


