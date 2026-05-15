/* eslint-disable @typescript-eslint/no-explicit-any, prefer-const, no-console, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-unused-vars */
/**
 * Lookup Service Module
 *
 * Purpose:
 * Provides a strongly-typed interface for querying the dynamically fetched lookup table
 * of Freshdesk Serviço Nível options and Tipos.
 */

import { FreshdeskAPI } from './api';
import { ContextManager } from './context';

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

// ─── Internal State ──────────────────────────────────────────────────────────

let lookupMap: Map<number, LookupEntry> = new Map();
let tipoList: TipoEntry[] = [];
let isInitialized = false;
let initPromise: Promise<void> | null = null;

// ─── Service Class ───────────────────────────────────────────────────────────

export class LookupService {
  private static readonly MAX_RESULTS = 15;
  private static cachedLeaves: LookupEntry[] | null = null;

  public static getAllTipos(): TipoEntry[] {
    return tipoList;
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
          const cached = await this.getFromCache();
          if (cached && !this.isCacheExpired(cached.timestamp)) {
            this.buildMapFromCache(cached.lookup, cached.tipos);
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
        console.error('[Atlas Comet] Erro ao inicializar LookupService:', error);
        // Fallback: If fetch fails, try to load from cache even if expired
        const cached = await this.getFromCache();
        if (cached) {
          console.log('[Atlas Comet] Usando cache expirado devido a falha na API.');
          this.buildMapFromCache(cached.lookup, cached.tipos);
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
    const cached = await this.getFromCache();
    return cached ? cached.timestamp : null;
  }

  private static parseFields(response: any) {
    lookupMap.clear();
    tipoList = [];
    this.cachedLeaves = null;

    let fieldsArray: any[] = [];
    if (Array.isArray(response)) {
      fieldsArray = response;
    } else if (response && response.ticket_fields) {
      fieldsArray = response.ticket_fields;
    }

    if (!fieldsArray || fieldsArray.length === 0) {
      throw new Error('Formato de campos inválido retornado pela API');
    }

    // 1. Parse Tipo do Ticket
    const tipoField = fieldsArray.find((f) => f.name === 'ticket_type' || f.label === 'Tipo');
    if (tipoField && tipoField.choices) {
      const choices = Array.isArray(tipoField.choices)
        ? tipoField.choices
        : Object.values(tipoField.choices);
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

    // 2. Parse Serviço Nível (Hierarchical - Freshdesk uses nested dictionaries/arrays)
    const servicoField = fieldsArray.find(
      (f) =>
        f.type === 'nested_field' &&
        (f.name === 'custom_fields' || f.label?.toLowerCase().includes('serviço')),
    );
    if (servicoField && servicoField.choices) {
      let autoId = 10000; // Generate IDs since Freshdesk nested dictionaries lack IDs

      const parseHierarchy = (choicesData: any, level: number, parents: LookupParent[]) => {
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

  private static async getFromCache(): Promise<any> {
    return new Promise((resolve) => {
      if (!ContextManager.isValid()) {
        resolve(null);
        return;
      }
      chrome.storage.local.get('atlas_fields_cache_v2', (res) => {
        resolve(res.atlas_fields_cache_v2 || null);
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
    };
    return new Promise((resolve) => {
      chrome.storage.local.set({ atlas_fields_cache_v2: cacheData }, resolve);
    });
  }

  private static isCacheExpired(timestamp: number): boolean {
    const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
    return Date.now() - timestamp > CACHE_TTL_MS;
  }

  private static buildMapFromCache(lookupArray: any[], tipos: any[]) {
    lookupMap = new Map(lookupArray);
    tipoList = tipos;
    this.cachedLeaves = null;
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


