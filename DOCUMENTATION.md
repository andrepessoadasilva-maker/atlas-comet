# Atlas Comet: Documentação Técnica e Arquitetural ☄️

## 1. Visão Geral e Propósito (High-Level)
O **Atlas Comet** é uma extensão para Google Chrome desenvolvida sob o padrão Manifest V3, projetada para operar como um assistente invisível e de altíssima performance no ambiente do Freshdesk. 

Sua missão central é **garantir a integridade absoluta dos dados para o Business Intelligence (BI)** da companhia, mitigando falhas humanas na operação de atendimento. Ele alcança isso automatizando a tabulação de tickets (Níveis 1, 2, 3 e Tipo) e forçando a padronização rigorosa dos assuntos no formato `Empresa - Cliente - Serviço`. Tudo isso operando dentro de uma Single Page Application (SPA) baseada em Ember.js, sem causar travamentos na interface.

---

## 2. Desafios de Engenharia e SPA (O Sentinela)

### 2.1. Navegação SPA e Retenção de Estado
* **O Desafio Mapeado:** O Freshdesk não recarrega a página (`F5`) ao trocar de um ticket para outro. Isso causava um efeito colateral grave: variáveis antigas, títulos e IDs de clientes anteriores ficavam retidos na memória do DOM, corrompendo a coleta do próximo ticket.
* **A Solução Arquitetural:** Foi implementado um "SPA Watcher" utilizando uma combinação de `MutationObserver` e `setInterval`. Este sentinela monitora ativamente as transições na URL e na árvore do DOM. Ao detectar uma mudança de ID na rota, a extensão limpa o cache interno e reinicia a esteira de captura de dados de forma cirúrgica.
* **Preservação de Bindings:** Houve um cuidado extremo para **não** utilizar métodos destrutivos como `node.remove()` ao atualizar a interface. A atualização do DOM é feita manipulando estritamente o `textContent` ou injetando nós adjacentes, garantindo que os *bindings* reativos nativos do Ember.js não fossem rompidos.

---

## 3. Pipeline de Extração de Dados e Resiliência (Os 3 Planos)

A extensão assume que o DOM do Freshdesk é volátil e não confia em uma única fonte de verdade. Foi desenhada uma esteira de captura com fallbacks sequenciais:

### Plano A: API V2 Direta (First-Choice)
A extensão busca IDs numéricos ocultos na barra lateral direita do ticket e realiza chamadas `fetch` nativas e assíncronas para as rotas `/api/v2/contacts/...` e `/api/v2/companies/...`. Isso garante o dado estruturado e limpo, direto do banco.

### Plano B: Team Inbox HTML Parse (Fallback de Empresa)
Quando a API falha ou a empresa não está explícita nos metadados, a extensão varre a URL do "Team Inbox". Utilizando a classe `DOMParser`, o sistema virtualiza o HTML da página de entrada e aplica Expressões Regulares (Regex) para isolar a string exata antes do primeiro hífen, recuperando a identidade corporativa do ticket.

### Plano C: Iframe Scraper Oculto (Mapeamento de Genéricos)
* **O Cenário Operacional:** Identificou-se que o banco de dados possuía contatos atrelados a entidades genéricas (ex: "Agência/Finder"), mascarando a real empresa.
* **A Solução:** A extensão injeta silenciosamente um `iframe` invisível no DOM, apontando para a rota interna `/crm/messaging/`. O script entra nesse iframe, raspa o cabeçalho original da conversa e extrai o verdadeiro nome da empresa subjacente. Após a coleta, o iframe é destruído para liberar memória.

---

## 4. Higienização Cirúrgica de Nomenclaturas (Cenários Reais)

O maior desafio do projeto foi lidar com o cadastro humano inconsistente. As seguintes lógicas de sanitização foram implementadas com base no monitoramento do uso real:

### 4.1. Cenário 1: Poluição Visual e Formatação de Nomes
* **O Problema Mapeado:** Contatos salvos com pontuações acidentais e formatação incorreta (ex: `Agnes. tamas` ou `joão  silva`).
* **A Solução (`formatProperName`):** Criou-se uma função de limpeza exclusiva para **Clientes** (deliberadamente isolada para não afetar as Razões Sociais complexas das **Empresas**). Esta função atua em quatro etapas:
  1. Remove qualquer ponto (`.`) e substitui por espaço.
  2. Executa um `.trim()` agressivo combinando Regex (`/\s+/g`) para colapsar múltiplos espaços em um só.
  3. Aplica uma regra estrita de *Title Case* (somente a primeira letra de cada palavra em maiúscula).
  4. Trunca o resultado em no máximo **3 nomes** (ex: "Agnes Tamas"), evitando que nomes extremamente longos quebrem a legibilidade do assunto final do ticket.

### 4.2. Cenário 2: O Falso Positivo do E-mail
* **O Problema Mapeado:** Clientes cadastrados incorretamente com o e-mail no campo do nome (ex: `tearjuntos@gmail.com`), resultando em assuntos de ticket deformados.
* **A Solução (Deep Scrape e Fallback de Mensagem):** Inseriu-se um gatilho condicional (`if string.includes('@')`). Quando ativado, a extensão abandona os dados da barra lateral e mergulha na estrutura de mensagens do ticket.
* **O Seletor:** A lógica realiza um `document.querySelector` caçando a `div` estilizada específica do remetente da primeira mensagem (mapeada com a assinatura `padding:0 5px 0 0;font-size:12px; color: #6f7071;margin-left: 33px`). O `textContent` dessa div (o verdadeiro nome da pessoa) é extraído e injetado na função `formatProperName` do Cenário 1.

---

## 5. Arquitetura de Tabulação, UI e Estado

### 5.1. Interface de Busca Rápida (LookupService)
* Desenvolveu-se um modal flutuante não-obstrusivo para inserção dos dados de categorização.
* O sistema conta com um motor de busca indexado que permite pesquisa por "tokens" parciais, destacando a sintaxe encontrada na tela em tempo real (`<strong>` nodes verdes).
* **Persistência de Estado:** O sistema salva a última preferência de filtros (Níveis de Serviço) e o último "Tipo" de ticket no `chrome.storage.local`, acelerando tickets recorrentes de um mesmo analista.

### 5.2. Gestão de Estado Silenciosa
* Em cenários onde todas as fontes de dados falham, a extensão não emite alertas bloqueantes. Ela aplica silenciosamente a tag predefinida `pendente_nome_empresa_cliente` no array do payload (`finalTags`) do Freshdesk. Isso permite que a auditoria da empresa localize as anomalias posteriormente, sem travar a produtividade atual do analista.

### 5.3. Main-World Bridge (Quebra de Isolamento)
* **O Desafio:** Extensões rodam em um "Isolated World" e não conseguem acionar funções JavaScript nativas da página.
* **A Solução:** O projeto utiliza a técnica de injeção de script via tag (`bridge-inject.js`). Isso permite atravessar o sandbox do Chrome, acessar a variável de ambiente para capturar o token de segurança (CSRF) e enviar o comando `ticket.reload()` diretamente ao *store* interno do Ember, forçando uma sincronização visual instantânea.

---

## 6. Tratamento de Erros, Memória e Qualidade de Código

* **Prevenção de Memory Leaks:** Todas as Promises de coleta de dados (via Fetch ou Iframe) possuem bloqueios de `timeout` de 15 segundos absolutos. Nenhuma requisição fica pendente consumindo recursos da aba.
* **Try/Catch Isolado:** Toda a interação DOM/API é fortemente envelopada. Falhas críticas (ex: Freshdesk muda uma classe CSS do nada) geram apenas avisos discretos de `console.warn`, ativando os fallbacks sequenciais e impedindo falhas em cascata ("crashes" da extensão).
* **Validação de Contexto:** Um `ContextManager` varre a validade da comunicação da extensão para evitar o fatídico erro *Extension context invalidated* (comum quando o Chrome atualiza a extensão no background).
* **Auditoria Contínua (Husky):** O repositório conta com ganchos Git rigorosos (`pre-commit`). Todo e qualquer commit passa obrigatoriamente por verificação de Linter (`npm run lint`) e validação estática de tipagem (`npm run type-check`), garantindo um padrão de código "Clean Code" perpétuo.
