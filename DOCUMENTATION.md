# Atlas Comet: Documentação Técnica

## 1. Visão Geral (High-Level)
O **Atlas Comet** é uma extensão para Google Chrome desenvolvida em Manifest V3 para otimizar o fluxo de trabalho de analistas no Freshdesk. Sua principal missão é automatizar a tabulação de tickets e a padronização de assuntos, eliminando erros manuais e garantindo que os dados estejam sempre precisos para relatórios de BI.

### Principais Funcionalidades
- **Auto-Rename de Assuntos**: Transforma assuntos genéricos ou poluídos em um formato padronizado: `Empresa - Cliente - Serviço`.
- **Tabulação Inteligente**: Permite definir os 3 níveis de serviço (N1, N2, N3) e o Tipo do ticket através de uma interface de busca ultra-rápida.
- **Detecção de Offline**: Identifica tickets originados de chats offline e oferece um fluxo de correção imediata.
- **Sincronização em Tempo Real**: Atualiza a interface do Freshdesk (Ember.js) sem necessidade de recarregar a página completa.

---

## 2. Detalhes das Funcionalidades (Low-Level)

### 2.1. Busca e Seleção de Assuntos
A extensão utiliza um `LookupService` que carrega uma tabela de campos aninhados do Freshdesk.
- **Interface**: Um modal flutuante com busca por tokens (multi-palavras) e destaque de sintaxe (`strong` nodes em verde).
- **Filtros**: Permite filtrar a busca por níveis (apenas N3 ou incluir N2).
- **Persistência**: Lembra a última preferência de filtros e o último "Tipo" selecionado pelo usuário via `chrome.storage.local`.

### 2.2. Automação de Assunto e Tags
Ao selecionar um serviço, a extensão executa um fluxo de enriquecimento de dados:
1. **Scraping**: Tenta ler o nome do cliente e empresa diretamente do DOM (Shadow DOM do MFE do Freshdesk).
2. **API Enrichment**: Complementa os dados via chamadas à API V2 (Contacts/Companies).
3. **Tagging**: Adiciona a tag `pendente_nome_empresa_cliente` caso os dados não sejam encontrados, alertando o analista.

---

## 3. Estratégia de Interação com a API
O Freshdesk é um SPA (Single Page Application) complexo. Para interagir com ele, o Atlas Comet utiliza três planos de ação para garantir que o nome da empresa e do cliente sejam sempre capturados:

### Plano A: API V2 Direta
- **Ação**: Realiza chamadas para `/api/v2/contacts/{id}` e `/api/v2/companies/{id}`.
- **Uso**: É a fonte da verdade primária para obter nomes completos sem as abreviações do DOM.

### Plano B: Ticket Enriquecido (Team Inbox Data)
- **Ação**: Chama `/api/v2/tickets/{id}?include=company`.
- **Uso**: Retorna o objeto da empresa já vinculado ao ticket em uma única requisição. Essencial quando o link da empresa não está presente no DOM.

### Plano C: Team Inbox Scraper (Hidden Iframe)
- **Ação**: Injeta um iframe oculto apontando para o Team Inbox do Freshdesk (`/crm/messaging/`).
- **Uso**: Caso a empresa seja identificada como "Agência/Finder" (um valor genérico no banco de dados), o scraper lê o cabeçalho da conversa no Team Inbox para extrair o nome real que o cliente digitou.

---

## 4. Tratamento de Erros e Resiliência
- **Fallbacks Silenciosos**: Se todos os planos falharem, a extensão utiliza o valor "Indefinido" e aplica uma tag de pendência, permitindo que o processo continue sem travar.
- **Try/Catch Robusto**: Todas as interações com API e DOM são envoltas em blocos de tratamento para evitar que falhas em um ticket específico afetem a estabilidade global da extensão.
- **Timeouts**: Requisições via Bridge e Iframe Scraper possuem timeouts de 15 segundos para evitar Promises pendentes que consomem memória.
- **Context Validation**: Um `ContextManager` verifica se a extensão foi atualizada ou desativada, impedindo erros de "Extension context invalidated" e notificando o usuário se um reload for necessário.

---

## 5. Arquitetura e Bibliotecas

### Core Stack
- **TypeScript**: Tipagem estrita para evitar erros em tempo de execução.
- **Vanilla JS/DOM**: Sem dependências pesadas de UI (React/Vue), garantindo performance máxima dentro do Freshdesk.
- **CSS Responsivo**: Estilização modular com animações personalizadas (Comet Loader).

### Componentes Chave
- **Main-World Bridge**: Arquivo `bridge-inject.js` injetado na página principal para acessar o token CSRF do Ember e forçar o `ticket.reload()` no store interno do Freshdesk.
- **MutationObserver**: Monitora transições de rota do SPA sem pollar a URL via `setInterval`.
- **Husky**: Cão de guarda que garante a qualidade do código rodando `lint` e `type-check` antes de cada commit.

---

*Atlas Comet - Precisão em cada órbita.*
