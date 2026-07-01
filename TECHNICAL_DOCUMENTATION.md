# Atlas Comet — Documentação Técnica Completa

> **Versão:** 1.2.194  
> **Última atualização:** Junho de 2026  
> **Tipo:** Chrome Extension (Manifest V3)  
> **Plataforma-alvo:** Freshdesk (SPA Ember.js)

---

## Índice

1. [Visão Geral](#1-visão-geral)
2. [Arquitetura do Sistema](#2-arquitetura-do-sistema)
3. [Estrutura de Arquivos](#3-estrutura-de-arquivos)
4. [Fluxo de Autenticação e CSRF](#4-fluxo-de-autenticação-e-csrf)
5. [API do Freshdesk — Como os Dados São Enviados](#5-api-do-freshdesk--como-os-dados-são-enviados)
6. [Atualização Dinâmica de Serviços (LookupService)](#6-atualização-dinâmica-de-serviços-lookupservice)
7. [Sistema de Navegação SPA (Roteamento)](#7-sistema-de-navegação-spa-roteamento)
8. [Observador de DOM (TicketObserver)](#8-observador-de-dom-ticketobserver)
9. [Interface do Usuário (UIFactory)](#9-interface-do-usuário-uifactory)
10. [Detecção e Tratamento de Chat Offline](#10-detecção-e-tratamento-de-chat-offline)
11. [Renomeação Automática de Assunto (Subject Auto-Rename)](#11-renomeação-automática-de-assunto-subject-auto-rename)
12. [Gerenciamento de Tags](#12-gerenciamento-de-tags)
13. [Sincronização do Ember.js (Reload sem Refresh)](#13-sincronização-do-emberjs-reload-sem-refresh)
14. [Sistema de Cache e Persistência](#14-sistema-de-cache-e-persistência)
15. [Gerenciamento de Contexto (ContextManager)](#15-gerenciamento-de-contexto-contextmanager)
16. [Sentinela de URL (SPA Watcher)](#16-sentinela-de-url-spa-watcher)
17. [Versionamento Automático](#17-versionamento-automático)
18. [Modelo de Segurança](#18-modelo-de-segurança)
19. [Pipeline de Build e Qualidade](#19-pipeline-de-build-e-qualidade)
20. [Fluxo Completo — Do Clique ao Ticket Atualizado](#20-fluxo-completo--do-clique-ao-ticket-atualizado)

---

## 1. Visão Geral

**Atlas Comet** é uma extensão Chrome (Manifest V3) que automatiza e acelera a tabulação de tickets no Freshdesk. Ela permite que agentes de suporte definam os campos **Serviço Nível 1**, **Serviço Nível 2**, **Serviço Nível 3** e **Tipo** de um ticket com poucos cliques, em vez de navegar manualmente pelos dropdowns nativos do Freshdesk.

### Problema Resolvido

O Freshdesk usa dropdowns encadeados (campos hierárquicos dependentes) para os níveis de serviço. Cada dropdown só carrega após o anterior ser selecionado, e os agentes precisam repetir esse processo para cada ticket. O Atlas Comet:

- Busca **todos os serviços** de uma só vez via API
- Apresenta uma **interface de busca com autocomplete**
- Envia os dados diretamente via **API interna** do Freshdesk
- Renomeia o assunto do ticket automaticamente com o padrão `Empresa - Cliente - Serviço`
- Gerencia tags de controle de forma inteligente

### Domínios Suportados

| Domínio | Tipo |
|---------|------|
| `*.freshdesk.com` | Principal |
| `ajuda.cvcrm.com.br` | Custom domain |
| `ajuda.anapro.com.br` | Custom domain |
| `*.myfreshworks.com` | Freshworks SSO |

---

## 2. Arquitetura do Sistema

A extensão segue uma arquitetura de três camadas, necessária pela natureza do Chrome Extensions Manifest V3 e pelas restrições de segurança do Freshdesk:

```
┌─────────────────────────────────────────────────────────────────┐
│                       CHROME BROWSER                            │
├─────────────────┬───────────────────────┬───────────────────────┤
│  SERVICE WORKER │   CONTENT SCRIPT      │    MAIN WORLD         │
│  (background.ts)│   (content.ts)        │    (bridge-inject.js) │
│                 │                       │                       │
│ ● webNavigation│ ● DOM observation      │ ● $.ajax requests     │
│   listener     │ ● UI injection         │ ● CSRF token access   │
│ ● SPA route    │ ● postMessage bridge   │ ● Ember store access  │
│   detection    │ ● Tag manipulation     │ ● jQuery integration  │
│                │ ● State management     │                       │
├─────────────────┼───────────────────────┼───────────────────────┤
│    chrome.*     │   Isolated World      │   Page's JS Context   │
│    APIs         │   (DOM compartilhado) │   (jQuery, Ember)     │
└─────────────────┴───────────────────────┴───────────────────────┘
         │                    │                       │
         │    sendMessage     │    window.postMessage  │
         ├───────────────────►│◄──────────────────────►│
         │                    │                        │
         │                    ▼                        ▼
         │          ┌──────────────────┐    ┌──────────────────┐
         │          │  Freshdesk DOM   │    │ Freshdesk API    │
         │          │  (leitura/escrita)│    │ /api/_/tickets   │
         │          └──────────────────┘    └──────────────────┘
```

### Por Que Três Camadas?

1. **Service Worker (background.ts):** Necessário para interceptar navegações SPA via `chrome.webNavigation.onHistoryStateUpdated`. O Freshdesk é um SPA Ember.js que usa a History API para navegar, e o Content Script não pode detectar essas mudanças sozinho.

2. **Content Script (content.ts):** Roda no **Isolated World** do Chrome — compartilha o DOM com a página, mas tem um contexto JavaScript **completamente separado**. Não tem acesso ao jQuery nem ao Ember.

3. **Bridge Script (bridge-inject.js):** Injected no **Main World** da página via `<script src>`. Roda com acesso total ao jQuery, Ember e todas as variáveis JavaScript do Freshdesk, incluindo o **token CSRF** que NÃO está disponível no DOM.

---

## 3. Estrutura de Arquivos

```
atlas-comet/
├── manifest.json              # Manifest V3 da extensão
├── bridge-inject.js           # Script injetado no Main World (CSRF + Ajax)
├── styles.css                 # CSS injetado nas páginas do Freshdesk
├── bump-version.js            # Script de versionamento automático
├── categorias.json            # Dados estáticos de categorias (legado)
├── data.json / fulldata.json  # Dados de lookup estáticos (fallback)
├── package.json               # Dependências e scripts npm
├── tsconfig.json              # Configuração TypeScript
├── .eslintrc.json             # Configuração ESLint
├── .prettierrc                # Configuração Prettier
│
├── src/
│   ├── content.ts             # Entry point do Content Script
│   ├── background.ts          # Service Worker (navegação SPA)
│   ├── api.ts                 # Camada de comunicação com API (Bridge Pattern)
│   ├── observer.ts            # MutationObserver para manter UI injetada
│   ├── ui.ts                  # Fábrica de UI segura (sem innerHTML)
│   ├── lookup.ts              # Serviço de busca hierárquica de campos
│   ├── state.ts               # Gerenciamento de estado Singleton
│   ├── context.ts             # Detector de invalidação de contexto
│   ├── constants.ts           # Constantes globais (seletores, URLs, textos)
│   ├── logger.ts              # Utilitário centralizado de logging
│   ├── assets.ts              # Assets embedados (ícones, etc.)
│   └── loader_data.ts         # Dados JSON da animação Lottie do loader
│
├── dist/                      # Output do build (content.js, background.js)
├── assets/icons/              # Ícones da extensão (16, 48, 128px)
└── .husky/                    # Git hooks (pre-commit validation)
```

---

## 4. Fluxo de Autenticação e CSRF

### O Problema

O Freshdesk protege suas APIs internas com tokens **CSRF** (Cross-Site Request Forgery). Diferentemente de muitas aplicações web que armazenam o token em uma `<meta>` tag ou cookie, o Freshdesk armazena o CSRF token **exclusivamente na memória JavaScript** da aplicação Ember.js — dentro do response body do endpoint `/api/_/bootstrap/me`.

O Content Script roda no **Isolated World** e **não tem acesso** às variáveis JavaScript da página. Portanto, ele não consegue ler o CSRF token diretamente.

### A Solução: Main-World Bridge

```
┌──────────────────────────────────────────────────────────────────────┐
│                    FLUXO DE AUTENTICAÇÃO                             │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. Content Script chama FreshdeskAPI.injectBridge()                 │
│     └─► Cria <script src="bridge-inject.js"> no DOM                 │
│         └─► Roda no MAIN WORLD (acesso ao jQuery e Ember)           │
│                                                                      │
│  2. Bridge Script (ao carregar):                                     │
│     └─► GET /api/_/bootstrap/me  (credenciais: same-origin)         │
│         └─► Extrai response.meta.csrf_token                         │
│         └─► Armazena em cachedCsrfToken (variável local)            │
│                                                                      │
│  3. Content Script envia requisição:                                 │
│     └─► window.postMessage({                                         │
│           type: '__AUTOTAB_API_REQUEST__',                           │
│           requestId: 'abc123...',                                    │
│           url: '/api/_/tickets/12345',                               │
│           method: 'PUT',                                             │
│           body: { type: '...', custom_fields: {...} }                │
│         })                                                           │
│                                                                      │
│  4. Bridge recebe a mensagem:                                        │
│     └─► Recupera o CSRF token cacheado                              │
│     └─► $.ajax({                                                     │
│           url: '/api/_/tickets/12345',                               │
│           method: 'PUT',                                             │
│           headers: { 'X-CSRF-Token': cachedCsrfToken },             │
│           data: JSON.stringify(body)                                 │
│         })                                                           │
│                                                                      │
│  5. Bridge envia resposta:                                           │
│     └─► window.postMessage({                                         │
│           type: '__AUTOTAB_API_RESPONSE__',                          │
│           requestId: 'abc123...',                                    │
│           success: true,                                             │
│           status: 200,                                               │
│           data: { ... }                                              │
│         })                                                           │
│                                                                      │
│  6. Content Script resolve a Promise correspondente ao requestId     │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Detalhes Técnicos do CSRF

| Aspecto | Detalhe |
|---------|---------|
| **Endpoint do token** | `GET /api/_/bootstrap/me` |
| **Localização no response** | `response.meta.csrf_token` |
| **Header enviado** | `X-CSRF-Token` |
| **Caching** | Token cacheado em memória após a primeira busca |
| **Retry** | Se a busca do token falhar, `csrfFetchPromise` é resetada para `null`, permitindo uma nova tentativa |
| **Requests GET** | Não requerem CSRF token |
| **Requests PUT** | Requerem CSRF token obrigatoriamente |

### Validação de URLs na Bridge

A Bridge implementa uma **whitelist** de endpoints para evitar requisições maliciosas:

```javascript
// Regex de validação na bridge-inject.js (linha 158)
/^(\/api\/_\/tickets\/\d+(\/update_properties)?|\/api\/(v2|_)\/ticket_fields)$/
```

Apenas estes endpoints são permitidos:
- `/api/_/tickets/{id}` — CRUD de tickets
- `/api/_/tickets/{id}/update_properties` — Atualização silenciosa de propriedades
- `/api/_/ticket_fields` — Leitura dos campos do ticket
- `/api/v2/ticket_fields` — Leitura dos campos (fallback v2)

---

## 5. API do Freshdesk — Como os Dados São Enviados

### Endpoints Utilizados

| Endpoint | Método | Descrição | Via |
|----------|--------|-----------|-----|
| `/api/_/tickets/{id}` | `PUT` | Atualiza serviço, tipo, assunto, tags | Bridge (jQuery) |
| `/api/_/tickets/{id}` | `GET` | Lê dados atuais do ticket (tags) | Bridge (jQuery) |
| `/api/_/tickets/{id}/update_properties` | `PUT` | Atualiza assunto e tags silenciosamente | Bridge (jQuery) |
| `/api/_/ticket_fields` | `GET` | Lista todos os campos e opções do ticket | Bridge (jQuery) |
| `/api/v2/ticket_fields` | `GET` | Fallback para campos (API pública v2) | Bridge (jQuery) |
| `/api/_/bootstrap/me` | `GET` | Obtenção do CSRF token | Bridge (fetch nativo) |
| `/api/v2/tickets/{id}?include=company` | `GET` | Dados do ticket com empresa | Content Script (fetch) |
| `/api/v2/contacts/{id}` | `GET` | Dados completos do contato | Content Script (fetch) |
| `/api/v2/companies/{id}` | `GET` | Dados completos da empresa | Content Script (fetch) |

### Payload de Atualização de Serviço

Quando o agente seleciona um serviço no modal de busca, o seguinte payload é construído e enviado:

```typescript
// Interface TypeScript (api.ts)
interface TicketUpdatePayload {
  type: string;                    // Ex: "Dúvida de Cliente"
  custom_fields: {
    cf_servio_nvel_1: string;      // Ex: "CV Prospectar"
    cf_servio_nvel_2: string;      // Ex: "APIs CV"  
    cf_servio_nvel_3: string;      // Ex: "Leads - Administrar"
  };
  subject?: string;                // Novo assunto (se ticket offline)
  tags?: string[];                 // Tags atualizadas (remove tag offline)
}
```

**Exemplo real de payload enviado:**
```json
{
  "type": "Dúvida de Cliente",
  "custom_fields": {
    "cf_servio_nvel_1": "CV Prospectar",
    "cf_servio_nvel_2": "APIs CV",
    "cf_servio_nvel_3": "Leads - Administrar"
  },
  "subject": "Empresa ABC - João Silva - Leads - Administrar",
  "tags": ["prioridade_alta"]
}
```

### Fluxo de Atualização Completa (2 Requisições)

A atualização de um ticket envolve **duas chamadas API sequenciais**:

```
  REQUISIÇÃO 1: updateServiceLevels()
  ├─ GET /api/_/tickets/{id}        → Lê tags atuais
  ├─ Constrói payload com tipo, serviços, assunto limpo e tags filtradas
  └─ PUT /api/_/tickets/{id}        → Envia payload de serviço

  REQUISIÇÃO 2: updateTicketSubjectSilently()
  └─ PUT /api/_/tickets/{id}/update_properties
     → Envia { subject: "Empresa - Cliente - Serviço", tags: [...] }
```

### Lógica de Limpeza de Assunto

Se o assunto do ticket contém `[CHAT] - OFFLINE`, ele é automaticamente removido:

```typescript
// api.ts, linhas 355-366
const currentSubject = heading.textContent?.trim() || '';
if (currentSubject.toUpperCase().includes('[CHAT] - OFFLINE')) {
  const cleanedSubject = currentSubject
    .replace(/\[CHAT\]\s*-\s*OFFLINE\s*-?\s*/gi, '')
    .trim();
  if (cleanedSubject.length > 0) {
    payload.subject = cleanedSubject;
  }
}
```

---

## 6. Atualização Dinâmica de Serviços (LookupService)

### Como Novos Serviços São Descobertos

O `LookupService` é o módulo responsável por manter a lista de serviços **sempre atualizada**. Ele **não usa dados hardcoded** — em vez disso, busca dinamicamente os campos e suas opções diretamente da API do Freshdesk.

### Fluxo de Inicialização

```
┌──────────────────────────────────────────────────────────────┐
│            FLUXO DO LOOKUP SERVICE                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Agente clica em "Definir Serviço"                        │
│     └─► LookupService.init(force = true)                     │
│                                                              │
│  2. Busca dados da API:                                      │
│     └─► FreshdeskAPI.fetchTicketFields()                     │
│         ├─► Tenta: GET /api/_/ticket_fields                  │
│         └─► Fallback: GET /api/v2/ticket_fields              │
│                                                              │
│  3. Parseia a resposta:                                      │
│     ├─► Extrai campo "ticket_type" (Tipo do Ticket)          │
│     │   └─► Popula tipoList: TipoEntry[]                    │
│     └─► Extrai campo "nested_field" (Serviço Nível)          │
│         └─► Parseia árvore hierárquica recursivamente        │
│             └─► Popula lookupMap: Map<number, LookupEntry>   │
│                                                              │
│  4. Salva no cache:                                          │
│     └─► chrome.storage.local.set('atlas_fields_cache_v2')    │
│                                                              │
│  5. Retorna dados para a UI renderizar no modal              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Parsing da Árvore Hierárquica

O Freshdesk retorna os campos de serviço como um **nested_field** com uma estrutura hierárquica. O parser suporta dois formatos:

**Formato 1: Arrays de objetos**
```json
[
  {
    "value": "CV Prospectar",
    "id": 123,
    "choices": [
      { "value": "APIs CV", "id": 456, "choices": ["Leads - Administrar", "Leads - Buscar"] }
    ]
  }
]
```

**Formato 2: Dicionários aninhados (objetos)**
```json
{
  "CV Prospectar": {
    "APIs CV": ["Leads - Administrar", "Leads - Buscar"],
    "Integrações": ["Webhook", "API REST"]
  }
}
```

O parser recursivo (`parseHierarchy`) unifica ambos os formatos em uma estrutura plana:

```typescript
interface LookupEntry {
  label: string;         // Nome do serviço (ex: "Leads - Administrar")
  value: string;         // Valor para a API
  choiceId: number;      // ID único gerado (auto-incremento)
  level: number;         // 1 = N1, 2 = N2, 3 = N3
  isLeaf: boolean;       // true = nó terminal (sem filhos)
  parents: LookupParent[];  // Cadeia de pais para breadcrumb
}
```

### Quando os Serviços São Atualizados

| Situação | Comportamento |
|----------|---------------|
| Agente clica em "Definir Serviço" | **Sempre** busca dados frescos da API (`force = true`) |
| Cache presente e < 12 horas | Usa cache se carregamento automático (não é o caso atual) |
| Cache presente mas > 12 horas | Busca novos dados da API |
| API falha + cache expirado existe | Usa cache expirado como fallback |
| API falha + nenhum cache | Exibe tela de erro com botão "Tentar Sincronizar Agora" |

### Cache

- **Chave:** `atlas_fields_cache_v2`
- **Armazenamento:** `chrome.storage.local`
- **TTL:** 12 horas
- **Conteúdo:** `{ timestamp, lookup: [id, LookupEntry][], tipos: TipoEntry[] }`

### Busca e Filtragem

O `searchLeaves()` implementa busca com:
- **Normalização Unicode:** Remove acentos via NFD + regex
- **Tokenização:** Divide a query em palavras individuais
- **Scoring:** Prioriza por: (1) prefixo exato, (2) todos tokens encontrados, (3) tokens parciais
- **Filtro por nível:** Checkboxes "Nível 2" e "Nível 3" no modal
- **Limite:** Máximo de 15 resultados

---

## 7. Sistema de Navegação SPA (Roteamento)

### O Desafio do SPA

O Freshdesk é construído com Ember.js e opera como **Single Page Application**. Navegar entre tickets (ex: `/a/tickets/123` → `/a/tickets/124`) acontece **sem recarregar a página** — o Ember usa a History API (`pushState`/`replaceState`) para atualizar a URL.

### Solução em Duas Camadas

**Camada 1: Service Worker (Background)**

```typescript
// background.ts
chrome.webNavigation.onHistoryStateUpdated.addListener(
  (details) => {
    chrome.tabs.sendMessage(details.tabId, {
      type: 'NAVIGATED',
      url: details.url,
    });
  },
  {
    url: CONSTANTS.URL.ALLOWED_HOST_SUFFIXES.map(
      (suffix) => ({ hostSuffix: suffix })
    ),
  },
);
```

- Escuta **todas** as mudanças de URL do SPA (não apenas tickets)
- Envia mensagem ao Content Script com a nova URL
- Filtra por domínios permitidos

**Camada 2: Content Script (ExtensionController)**

```typescript
// content.ts
private handleRouting(url: string): void {
  const ticketId = this.appState.extractTicketIdFromUrl(url);
  
  if (this.currentSessionTicketId !== ticketId) {
    this.appState.clearProcessedTicket();
    this.currentSessionTicketId = ticketId;
  }

  if (ticketId) {
    this.ticketObserver.startObserving(ticketId);
  } else {
    this.ticketObserver.disconnect();
  }
}
```

- Avalia a URL para decidir se estamos em um ticket
- Limpa o cache de ticket processado ao mudar de ticket
- Inicia ou para o observer conforme necessário

**Camada 3: Popstate Listener**

```typescript
window.addEventListener('popstate', () => {
  this.handleRouting(window.location.href);
});
```

Captura navegações via botões Voltar/Avançar do browser.

---

## 8. Observador de DOM (TicketObserver)

### Propósito

O `TicketObserver` garante que os botões do Atlas Comet permaneçam visíveis no header do ticket, mesmo quando o Ember.js re-renderiza o DOM dinamicamente.

### Implementação

```typescript
// observer.ts
public startObserving(ticketId: string): void {
  this.disconnect();
  this.currentTicketId = ticketId;

  // MutationObserver principal
  this.observer = new MutationObserver(() => {
    this.maintainUI(ticketId);
  });

  this.observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Polling de fallback (500ms)
  this.pollIntervalId = setInterval(() => {
    this.maintainUI(ticketId);
  }, 500);
}
```

### Estratégia Dual

| Mecanismo | Propósito |
|-----------|-----------|
| `MutationObserver` | Reage instantaneamente a mudanças no DOM |
| `setInterval(500ms)` | Fallback para edições manuais que não disparam mutações |

### `maintainUI()` — Lógica Central

1. **Valida a URL** — Verifica se ainda estamos em `/a/tickets/{id}`
2. **Busca o container do header** — `.page-actions__left` ou `.ticket-details-header .action-bar`
3. **Verifica existência dos botões** — `#atlas-comet-header-buttons`
4. **Detecta status offline** — Lê valores dos dropdowns "Tipo", "Serviço Nível 2/3"
5. **Injeta ou atualiza botões** — Chama `UIFactory.renderHeaderButtons()`

### Lifecycle

```
  startObserving(ticketId)
       │
       ├─► Limpa observer anterior
       ├─► Cria novo MutationObserver
       ├─► Inicia polling de 500ms
       └─► Chama maintainUI() imediatamente
       
  disconnect()
       │
       ├─► Para o polling (clearInterval)
       ├─► Desconecta o MutationObserver
       ├─► Remove #atlas-comet-header-buttons
       └─► Remove #atlas-comet-offline-label
```

---

## 9. Interface do Usuário (UIFactory)

### Princípio de Segurança

Todo o DOM é construído **exclusivamente** via `document.createElement()` e `textContent`. O uso de `innerHTML` é **proibido** para conteúdo dinâmico (apenas permitido para SVGs estáticos inline).

### Componentes da UI

#### 9.1. Botões do Header

Dois botões são injetados no header do ticket:

| Botão | ID | Condição de exibição |
|-------|-----|---------------------|
| **Definir Serviço** | `#iniciar-busca` | Sempre visível em tickets |
| **Sim, Offline** | `#confirm-offline` | Apenas quando ticket tem status "Chat Offline" e tag não foi adicionada |

#### 9.2. Modal de Busca de Serviço

Overlay full-screen com:

- **Campo "Tipo do Ticket"** — Input com autocomplete e dropdown dinâmico
  - Valor padrão: "Dúvida de Cliente" (ou preferência salva)
  - Botão "Lembrar Tipo" para persistir preferência
  
- **Campo "Buscar Serviço"** — Input com ícone de lupa
  - Busca live em tempo real (sem debounce — busca é sub-millisecond)
  - Highlighting de texto com suporte a múltiplos tokens e acentos
  
- **Filtros de Nível** — Checkboxes "Mostrar Serviço Nível 2" e "Mostrar Serviço Nível 3"
  - Estado persistido via "Lembrar Preferências"
  - Safety lock: se nenhum nível selecionado, mostra aviso

- **Lista de Resultados** — Cards clicáveis com:
  - Nome do serviço (label) em destaque
  - Badge colorido do N1 (categorização visual por vertical CV)
  - Breadcrumb completo (N1 > N2 > N3)
  - Hover effects

#### 9.3. Toast Notifications (Premium Pro)

Após clicar em um resultado, o modal transiciona para um **toast animado**:

| Estado | Visual | Duração |
|--------|--------|---------|
| **Processing** | Animação Lottie (cometa orbitando) + texto "Definindo serviço..." | Enquanto API processa |
| **Success** | Ícone de checkmark SVG + "Assunto definido!" | 800ms |
| **Error** | Triângulo de warning SVG + detalhes do erro | 5 segundos |

#### 9.4. Label de Offline

Badge vermelho piscante (`atlas-comet-blink`) ao lado do título do ticket:
- Ícone SVG de warning
- Texto "Ticket Offline"
- Removido automaticamente após tabulação ou confirmação

#### 9.5. Banner de Contexto Invalidado

Banner fixo vermelho no topo da página com botão "Recarregar Agora":
- Aparece quando a extensão é atualizada enquanto a página está aberta
- Animação de slide-down

### Badge Colors por Vertical

| N1 Category | Background | Text Color |
|-------------|-----------|------------|
| CV Prospectar | `#fde8e8` | `#b91c1c` |
| CV Gerenciar | `#FFF9C4` | `#827717` |
| CV Vender | `#d1fae5` | `#065f46` |
| CV Relacionar | `#dbeafe` | `#1e40af` |
| Outros | `#f0f0f0` | `#666` |

---

## 10. Detecção e Tratamento de Chat Offline

### Detecção

O `detectOfflineStatus()` verifica se algum dos campos "Tipo", "Serviço Nível 2" ou "Serviço Nível 3" contém o valor `"Chat Offline"`:

```typescript
const levelSelectors = [
  `div[data-test-id="Tipo"]`,
  `div[data-test-id="Serviço Nível 2"]`,
  `div[data-test-id="Serviço Nível 3"]`,
];
```

### Fluxo de Confirmação

```
  1. Observer detecta "Chat Offline" nos campos
  2. Botão "Sim, Offline" aparece no header
  3. Label vermelha piscante aparece no título
  
  Cenário A: Agente clica "Sim, Offline"
     └─► cleanSubjectInDOM()     — Remove [CHAT] - OFFLINE do título
     └─► fillTagAndSelect()      — Adiciona tag "atlas_comet_offline"
     └─► Remove botão e label

  Cenário B: Agente usa "Definir Serviço"
     └─► API remove a tag "atlas_comet_offline" automaticamente
     └─► Remove label e botão na UI
     └─► AppState.setServiceDefined(true) impede re-trigger
```

### Tag Auto-Fill

O `fillTagAndSelect()` simula a interação humana com o campo de tags do Ember:

1. Foca o input de tags
2. Injeta o valor "atlas_comet_offline"
3. Dispara evento `input` para trigger do Ember
4. `waitForOptionAndClick()` usa MutationObserver para detectar quando o dropdown renderiza
5. Simula mousedown → mouseup → click na opção correspondente
6. Encontra e clica o botão "Atualizar" do formulário

---

## 11. Renomeação Automática de Assunto (Subject Auto-Rename)

### Formato do Assunto

```
{Empresa} - {Cliente} - {Serviço}
```

**Exemplo:** `CV CRM Ltda - João Silva - Leads - Administrar`

### Captura de Dados — Estratégia em Camadas

A extração de nome da empresa e do cliente usa uma arquitetura de **fallbacks escalonados**:

```
┌──────────────────────────────────────────────────────────────┐
│  CAPTURA DE EMPRESA                                          │
│                                                              │
│  Camada 1: Shadow DOM (layout legado do Freshdesk)           │
│     └─ mfe-application[app-id="fw-unified-mfe--contact-info"]│
│        └─ shadowRoot.querySelector('a[href*="/companies/"]') │
│                                                              │
│  Camada 2: Documento principal (layout Junho/2026)           │
│     └─ document.querySelector('a[href*="/a/companies/"]')    │
│                                                              │
│  Camada 3: API V2 enriquecida                                │
│     └─ GET /api/v2/tickets/{id}?include=company              │
│        └─ response.company.name                              │
│                                                              │
│  Camada 4: Regra "Agência/Finder"                            │
│     └─ Se empresa = "Agência/Finder", força Plano C          │
│                                                              │
│  Camada 5 (Plano C): Team Inbox via Iframe oculto            │
│     └─ Injeta iframe invisível com href do Team Inbox        │
│     └─ Content script roda dentro do iframe (all_frames=true)│
│     └─ Scraping do nome via MutationObserver                 │
│     └─ Comunica via postMessage ao parent                    │
│     └─ Timeout de 15 segundos                                │
│                                                              │
│  Resultado final: "Empresa Indefinida" se tudo falhar        │
├──────────────────────────────────────────────────────────────┤
│  CAPTURA DE CLIENTE                                          │
│                                                              │
│  Camada 1: Shadow DOM (layout legado)                        │
│     └─ shadowRoot.querySelector('a[href*="/contacts/"]')     │
│                                                              │
│  Camada 2: Documento principal                               │
│     └─ document.querySelector('a[href*="/a/contacts/"]')     │
│                                                              │
│  Camada 3: Ember data-test-id                                │
│     └─ a[data-test-id="user-name"][href*="/contacts/"]       │
│                                                              │
│  Camada 4: API V2 (nome completo)                            │
│     └─ GET /api/v2/contacts/{contactId}                      │
│        └─ response.name                                      │
│                                                              │
│  Camada 5: Fallback para email                               │
│     └─ Se nome contém '@', busca no primeiro remetente       │
│                                                              │
│  Resultado final: "Cliente Indefinido" se tudo falhar        │
└──────────────────────────────────────────────────────────────┘
```

### Formatação de Nomes (`formatProperName`)

**Empresa:**
- Remove texto após primeiro hífen
- Remove reticências (`..`)
- Remove palavras duplicadas consecutivas

**Cliente:**
- Remove pontos e substitui por espaço
- Aplica Title Case rigoroso
- Limita a **3 nomes principais** (preposições não contam)
- Remove preposições "penduradas" no final (De, Da, Do, Das, Dos, E)
- Remove nomes duplicados consecutivos

**Exemplos:**

| Input | Output |
|-------|--------|
| `"joao.silva.oliveira"` | `"João Silva Oliveira"` |
| `"MARIA DA SILVA SANTOS DE OLIVEIRA"` | `"Maria Da Silva Santos"` |
| `"pedro pedro souza"` | `"Pedro Souza"` |
| `"ana de"` | `"Ana"` |

### Tags Inteligentes

Após a renomeação, a lógica de tags avalia o resultado:

```typescript
const finalTags = currentTags.filter(
  (tag) => tag !== 'pendente_nome_empresa_cliente' 
         && tag !== CONSTANTS.VALUES.OFFLINE_TAG,
);

if (companyName === 'Indefinido' || clientName === 'Indefinido') {
  finalTags.push('pendente_nome_empresa_cliente');
}
```

---

## 12. Gerenciamento de Tags

### Tags de Controle

| Tag | Propósito | Adicionada quando | Removida quando |
|-----|-----------|-------------------|-----------------|
| `atlas_comet_offline` | Marca ticket como confirmado offline | Agente clica "Sim, Offline" | Serviço é definido via modal |
| `pendente_nome_empresa_cliente` | Indica nome incompleto | Empresa ou cliente retorna "Indefinido" | — |

### Remoção de Tag do DOM

```typescript
UIFactory.removeTagFromDOM(tagToRemove):
  1. Busca o container de tags (data-test-id="new-ticket-tags")
  2. Encontra o <li> que contém o texto da tag
  3. Localiza o botão de "fechar" (ember-power-select-multiple-remove-btn)
  4. Simula mousedown + click no botão
```

---

## 13. Sincronização do Ember.js (Reload sem Refresh)

### O Problema

Após atualizar o ticket via API, o Ember.js **não sabe** que os dados mudaram — seu modelo in-memory está desatualizado. Um `window.location.reload()` funcionaria mas é UX ruim.

### Solução: Ember Model Reload via Bridge

```
Content Script                          Bridge (Main World)
     │                                       │
     │  postMessage({                        │
     │    type: '__AUTOTAB_API_RELOAD_TICKET__',
     │    ticketId: '12345'                  │
     │  })                                   │
     │──────────────────────────────────────►│
     │                                       │
     │                    Ember.Application.NAMESPACES
     │                    .find(n => n.__container__)
     │                    .__container__
     │                    .lookup('service:store')
     │                    .peekRecord('ticket', ticketId)
     │                    .reload()
     │                                       │
     │         Ember re-fetches data from    │
     │         Freshdesk and re-renders      │
     │         the properties sidebar        │
     │                                       │
```

---

## 14. Sistema de Cache e Persistência

### Dados Armazenados no `chrome.storage.local`

| Chave | Tipo | Conteúdo | TTL |
|-------|------|----------|-----|
| `atlas_fields_cache_v2` | Object | `{ timestamp, lookup, tipos }` | 12 horas |
| `atlas_user_prefs` | Object | `{ n3: boolean, n2: boolean }` | Indefinido |
| `atlas_tipo_pref` | String | Tipo salvo (ex: "Dúvida de Cliente") | Indefinido |

---

## 15. Gerenciamento de Contexto (ContextManager)

### O Problema

Quando a extensão é atualizada ou recarregada, o Content Script perde acesso às APIs do Chrome (`chrome.runtime.id` retorna `undefined`). Qualquer chamada subsequente lança `"Extension context invalidated"`.

### Solução

```typescript
public static isValid(): boolean {
  if (this.isInvalidated) return false;
  try {
    if (!chrome?.runtime?.id) {
      this.handleInvalidation();
      return false;
    }
    return true;
  } catch (e) {
    this.handleInvalidation();
    return false;
  }
}
```

### Verificações em Toda a Aplicação

`ContextManager.isValid()` é chamado antes de:
- Cada ciclo do MutationObserver
- Cada ciclo do polling de fallback
- Cada chamada a `chrome.storage.local`
- Injeção da bridge
- Navegação SPA

### Proteção Global

```typescript
window.addEventListener('error', (event) => handleError(event.error));
window.addEventListener('unhandledrejection', (event) => handleError(event.reason));
```

Captura erros de contexto invalidado que escapam de try/catch locais.

---

## 16. Sentinela de URL (SPA Watcher)

### Propósito

Funciona como uma rede de segurança adicional para detectar mudanças de ticket em cenários onde o Background Script e o popstate listener falham (ex: cache agressivo do Ember, transições parciais).

### Implementação

```typescript
// ui.ts, linhas 1630-1679
setInterval(() => {
  const pathname = window.location.pathname;
  const currentTicketId = pathname.split('/').pop();
  
  if (pathname.includes('/a/tickets/') && 
      currentTicketId !== lastTicketId &&
      currentTicketId.match(/^\d+$/)) {
    lastTicketId = currentTicketId;
    handleTicketNavigation(currentTicketId);
  } else if (!pathname.includes('/a/tickets/')) {
    lastTicketId = null;
    // Remove botões órfãos
  }
}, 1000);
```

### O que `handleTicketNavigation` faz

Quando detecta um novo ticket:
1. `GET /api/v2/tickets/{newId}` — Busca dados do novo ticket
2. Atualiza o `textContent` do `.ticket-subject-heading` diretamente
3. Preserva bindings do Ember modificando apenas o nó de texto existente

---

## 17. Versionamento Automático

### Script `bump-version.js`

Executado automaticamente como `prebuild` hook antes de cada `npm run build`:

```javascript
// Lê package.json e manifest.json
// Incrementa a parte "patch" da versão (ex: 1.2.193 → 1.2.194)
// Escreve de volta em ambos os arquivos
```

### Integração no Build

```json
"scripts": {
  "prebuild": "node bump-version.js",
  "build": "esbuild src/content.ts --bundle --outfile=dist/content.js && esbuild src/background.ts --bundle --outfile=dist/background.js"
}
```

---

## 18. Modelo de Segurança

### Ameaças Mitigadas

| Ameaça | Vetor | Mitigação |
|--------|-------|-----------|
| **XSS via DOM Injection** | Dados de ticket injetados via `innerHTML` | `textContent` para todo conteúdo dinâmico |
| **CSRF** | Requisições forjadas | Token obtido via `/api/_/bootstrap/me` |
| **URL Hijack na Bridge** | Bridge fazendo requests para endpoints não autorizados | Whitelist regex de URLs permitidas |
| **Prototype Pollution** | Ember.js modifica protótipos nativos | Content Script roda em Isolated World |
| **DOM Clobbering** | Elementos da página com IDs conflitantes | IDs prefixados (`atlas-comet-*`) |
| **Context Invalidation** | Extensão atualizada durante uso | `ContextManager` com verificação proativa |
| **Response Spoofing** | Respostas falsas via postMessage | Request IDs únicos por requisição |
| **Dependências maliciosas** | npm supply chain | Zero dependências externas em produção (apenas lottie-web para animação) |
| **Same-Origin Bypass** | postMessage de origens externas | Verificação `event.origin === window.location.origin` |

### Request ID System

Cada requisição via bridge recebe um ID único:
```typescript
const requestId = Math.random().toString(36).substring(2) + Date.now().toString(36);
```

O ID é usado para:
1. Mapear respostas ao Promise correto (evita cross-talk)
2. Implementar timeout de 15 segundos por requisição
3. Limpar requests pendentes em caso de erro

---

## 19. Pipeline de Build e Qualidade

### Ferramentas de Desenvolvimento

| Ferramenta | Versão | Propósito |
|------------|--------|-----------|
| TypeScript | ^5.4.5 | Type safety |
| esbuild | ^0.28.0 | Bundler ultrarrápido |
| ESLint | ^8.57.0 | Linting |
| Prettier | ^3.2.5 | Formatação |
| Husky | ^9.1.7 | Git hooks |
| Vitest | ^4.1.6 | Testing |

### Comandos

| Comando | Descrição |
|---------|-----------|
| `npm run build` | Bump version + bundle content.ts e background.ts |
| `npm run lint` | Verifica erros de lint |
| `npm run format` | Formata código com Prettier |
| `npm run type-check` | Verifica tipos TypeScript (sem emitir) |

### Build Output

O esbuild gera **dois bundles**:
1. `dist/content.js` — Content Script (UI + API + Observer + Lookup)
2. `dist/background.js` — Service Worker (Navegação SPA)

Ambos são single-file bundles sem dependências externas (exceto lottie-web que é inlined).

### Política de Qualidade

- **Pre-commit hook** (Husky): Bloqueia commits com erros de lint ou tipo
- **Strict TypeScript**: `strict: true`, `forceConsistentCasingInFileNames: true`
- **ESLint rules**: `no-console: warn`, `explicit-function-return-type: warn`

---

## 20. Fluxo Completo — Do Clique ao Ticket Atualizado

```
┌─────────────────────────────────────────────────────────────────────┐
│  FLUXO COMPLETO: AGENTE DEFINE SERVIÇO DE UM TICKET                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. NAVEGAÇÃO                                                       │
│     ├─ Freshdesk navega para /a/tickets/12345                      │
│     ├─ Background Script detecta via webNavigation                  │
│     ├─ Envia mensagem NAVIGATED ao Content Script                   │
│     ├─ ExtensionController.handleRouting() extrai ticketId          │
│     └─ TicketObserver.startObserving('12345')                      │
│                                                                     │
│  2. UI INJECTION                                                    │
│     ├─ MutationObserver detecta .page-actions__left no DOM         │
│     ├─ UIFactory.renderHeaderButtons() cria botão "Definir Serviço"│
│     ├─ detectOfflineStatus() verifica "Chat Offline"               │
│     └─ Se offline: adiciona botão "Sim, Offline" + label vermelha  │
│                                                                     │
│  3. AGENTE CLICA "DEFINIR SERVIÇO"                                 │
│     ├─ LookupService.init(force=true)                              │
│     │   ├─ FreshdeskAPI.fetchTicketFields()                        │
│     │   │   ├─ injectBridge() → <script src="bridge-inject.js">   │
│     │   │   ├─ Bridge: GET /api/_/bootstrap/me → CSRF token       │
│     │   │   ├─ postMessage: __AUTOTAB_API_REQUEST__ (GET fields)   │
│     │   │   ├─ Bridge: $.ajax GET /api/_/ticket_fields             │
│     │   │   └─ postMessage: __AUTOTAB_API_RESPONSE__ (fields data) │
│     │   ├─ parseFields(): Árvore → Map<id, LookupEntry>           │
│     │   └─ saveToCache(): chrome.storage.local                     │
│     └─ UIFactory.openSearchModal()                                 │
│                                                                     │
│  4. AGENTE BUSCA E SELECIONA SERVIÇO                               │
│     ├─ Input: "leads adm"                                          │
│     ├─ searchLeaves(): normaliza, tokeniza, pontua, filtra         │
│     ├─ renderSearchResults(): lista com badges e breadcrumbs       │
│     └─ Agente clica em "Leads - Administrar [CV Prospectar]"       │
│                                                                     │
│  5. PROCESSAMENTO                                                   │
│     ├─ Toast PROCESSING (Lottie comet animation)                   │
│     │                                                               │
│     ├─ CAPTURA DE DADOS (paralela):                                │
│     │   ├─ Empresa: Shadow DOM → Main DOM → API V2 → Team Inbox   │
│     │   ├─ Cliente: Shadow DOM → Main DOM → data-test-id → API V2  │
│     │   └─ Tags atuais: GET /api/v2/tickets/{id}?include=company  │
│     │                                                               │
│     ├─ FORMATAÇÃO:                                                  │
│     │   ├─ formatProperName(empresa) → "CV CRM Ltda"              │
│     │   ├─ formatProperName(cliente) → "João Silva"                │
│     │   └─ newSubject = "CV CRM Ltda - João Silva - Leads - Admin" │
│     │                                                               │
│     ├─ REQUISIÇÃO 1: updateServiceLevels()                         │
│     │   ├─ GET /api/_/tickets/12345 → lê tags                     │
│     │   ├─ Filtra tag offline + limpa assunto [CHAT] - OFFLINE     │
│     │   └─ PUT /api/_/tickets/12345 → payload com serviços+tipo   │
│     │                                                               │
│     ├─ REQUISIÇÃO 2: updateTicketSubjectSilently()                 │
│     │   └─ PUT /api/_/tickets/12345/update_properties              │
│     │       → { subject: newSubject, tags: finalTags }             │
│     │                                                               │
│     ├─ ESTADO:                                                      │
│     │   ├─ AppState.setServiceDefined(true)                        │
│     │   ├─ Atualiza .ticket-subject-heading no DOM (UX imediato)   │
│     │   ├─ Remove label offline + botão "Sim, Offline"             │
│     │   └─ Remove tag offline do DOM visual                        │
│     │                                                               │
│     └─ SYNC EMBER:                                                  │
│         ├─ postMessage: __AUTOTAB_API_RELOAD_TICKET__              │
│         ├─ Bridge: Ember store.peekRecord('ticket').reload()       │
│         └─ Ember re-renderiza sidebar com dados atualizados        │
│                                                                     │
│  6. FEEDBACK FINAL                                                  │
│     ├─ Toast SUCCESS (checkmark SVG) — 800ms                      │
│     └─ Modal fecha automaticamente                                 │
│                                                                     │
│  EM CASO DE ERRO:                                                   │
│     ├─ Toast ERROR (warning triangle SVG)                          │
│     ├─ Exibe mensagem de erro + detalhes técnicos                  │
│     └─ Modal fecha em 5 segundos                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Apêndice A: Interception de Iframe (Team Inbox Scraping)

O Content Script roda com `all_frames: true` no manifest. Quando carregado dentro de um iframe do Team Inbox (`/crm/messaging/`), ele executa uma rotina especial ao invés da extensão completa:

```typescript
if (window !== window.parent && 
    window.location.href.includes('/crm/messaging/')) {
  // Tenta extrair nome da empresa do DOM do Team Inbox
  // Comunica resultado via postMessage ao parent
  // NÃO carrega a extensão completa
}
```

## Apêndice B: Permissões da Extensão

| Permissão | Tipo | Justificativa |
|-----------|------|---------------|
| `webNavigation` | Permission | Detectar navegação SPA (History API) |
| `storage` | Permission | Cache de campos e preferências do usuário |
| `https://*.freshdesk.com/*` | Host Permission | Injeção do Content Script e requisições API |
| `https://*.myfreshworks.com/*` | Host Permission | SSO Freshworks |
| `https://ajuda.cvcrm.com.br/*` | Host Permission | Domínio customizado |
| `https://ajuda.anapro.com.br/*` | Host Permission | Domínio customizado |

## Apêndice C: Glossário

| Termo | Definição |
|-------|-----------|
| **N1 / Serviço Nível 1** | Categoria de serviço de primeiro nível (ex: "CV Prospectar") |
| **N2 / Serviço Nível 2** | Subcategoria de segundo nível (ex: "APIs CV") |
| **N3 / Serviço Nível 3** | Opção terminal/folha (ex: "Leads - Administrar") |
| **Tipo** | Classificação do ticket (ex: "Dúvida de Cliente") |
| **Bridge** | Script injetado no Main World para acessar jQuery e CSRF |
| **Isolated World** | Contexto JavaScript separado do Content Script do Chrome |
| **Main World** | Contexto JavaScript da página (compartilhado com Freshdesk) |
| **Leaf Entry** | Entrada terminal da árvore hierárquica (sem filhos) |
| **Tabulação** | Ato de preencher os campos de serviço de um ticket |

---

> **Nota:** Esta documentação reflete o estado do código na versão 1.2.194. Para mudanças subsequentes, consulte o histórico de commits do repositório.
