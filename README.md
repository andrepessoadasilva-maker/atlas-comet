# Atlas Comet ☄️
> Tickets na rota certa. Automação e precisão para a tabulação de tickets no Freshdesk.

O **Atlas Comet** é uma extensão de produtividade projetada para analistas que utilizam o Freshdesk. Ela padroniza o preenchimento de campos de serviço e a nomenclatura de assuntos, garantindo integridade de dados e economia de tempo.

## 🚀 Tecnologias e Dependências
- **Manifest V3**: Padrão moderno e seguro para extensões Chrome.
- **TypeScript**: Desenvolvimento robusto com tipagem estática.
- **Vanilla CSS**: Interface premium, leve e responsiva.
- **Husky**: Automação de qualidade (Pre-commit hooks).
- **Esbuild**: Bundler ultra-rápido para compilação.

## 🛠️ Configuração do Ambiente (Setup)

### 1. Pré-requisitos
- [Node.js](https://nodejs.org/) instalado.
- [Git](https://git-scm.com/) instalado.

### 2. Instalação Local
Siga os passos abaixo para configurar o projeto em sua máquina:

1. **Clonar o repositório**:
   ```bash
   git clone [URL_DO_REPOSITORIO]
   cd Atlas_Comet
   ```

2. **Instalar dependências**:
   ```bash
   npm install
   ```

3. **Compilar o projeto**:
   ```bash
   npm run build
   ```
   *Este comando irá gerar os arquivos finais na pasta `/dist`.*

### 3. Carregar no Google Chrome
1. Abra o Chrome e vá para `chrome://extensions/`.
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação**.
4. Selecione a pasta raiz do projeto (`Atlas_Comet`).

## 📋 Comandos Úteis
- `npm run build`: Compila o TypeScript e gera o bundle JS.
- `npm run lint`: Verifica erros de padronização no código.
- `npm run type-check`: Valida a integridade dos tipos TypeScript.
- `npm run format`: Formata automaticamente os arquivos usando Prettier.

---

## 📖 Documentação Adicional
Para detalhes técnicos profundos sobre a arquitetura, planos de API e tratamento de erros, consulte o arquivo [DOCUMENTATION.md](./DOCUMENTATION.md).

---
*Desenvolvido com foco em performance e segurança.*
