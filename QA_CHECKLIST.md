
# DoliGenAI - Log de Verificação do Sistema

Este documento serve como um roteiro de QA (Quality Assurance) para validar a estabilidade e funcionalidade da aplicação.

**Atualização:** Implementação de Mock Data concluída para "Demo Mode". O teste de UI agora pode ser realizado sem conexão real.

## 1. Infraestrutura & Conexão (Caminho Crítico)
**Prioridade: Alta** - Se isso falhar, nada mais funciona.

- [x] **Carregamento Inicial:** A aplicação abre sem tela branca (White Screen)?
- [x] **Configuração de API (Settings):**
    - [x] Inserir URL inválida -> O sistema exibe erro amigável?
    - [x] Inserir URL válida e API Key -> Botão "Test Connection" retorna sucesso?
    - [x] Salvar -> Recarregar a página (F5). As configurações persistem?
- [x] **Modo Demo (TESTE IMEDIATO):**
    - [x] Ativar "Demo Mode" em Settings -> Os dados fictícios aparecem no Dashboard?
- [x] **Sincronização de Dados:**
    - [x] Clicar no botão "Sync Data" (rodapé da sidebar).
    - [x] O ícone de carregamento aparece?
    - [x] Verificar Console do navegador (F12) por erros `403 Forbidden` ou `CORS`.
- [x] **Cache Offline (IndexedDB):**
    - [x] Desconectar internet (ou backend).
    - [x] Recarregar a página. Os dados antigos aparecem?
    - [x] Ir em Settings -> "Clear Cache". A limpeza funciona?

## 2. CRM & Dados Mestres
**Arquivos:** `components/CustomerList.tsx`, `components/ProductList.tsx`

- [x] **Lista de Clientes:**
    - [x] A lista carrega os dados mockados ou reais?
    - [x] Filtro de pesquisa (Search) funciona?
    - [x] Abas de filtro (All/Customers/Prospects) alteram a lista?
- [x] **Detalhes do Cliente:**
    - [x] Clicar em um cliente abre o painel lateral?
    - [x] As abas internas (Overview, Contacts, Invoices) mostram dados relacionados?
- [x] **Catálogo de Produtos:**
    - [x] Lista renderiza com badges de estoque corretos?
    - [x] Filtro (Product vs Service) funciona?

## 3. Comercial & Financeiro
**Arquivos:** `components/InvoiceList.tsx`, `components/OrderList.tsx`

- [x] **Faturas (Invoices):**
    - [x] Badges de status (Paid/Unpaid/Draft) estão com as cores certas?
    - [x] Botão de "Pay" (ícone cartão) abre o modal de pagamento?
    - [x] Botão de download tenta abrir o link do documento?
- [x] **Pedidos (Orders):**
    - [x] Lista renderiza?
    - [x] Clicar no pedido mostra os itens de linha?

## 4. Gestão de Projetos
**Arquivos:** `components/ProjectList.tsx`

- [x] **Lista de Projetos:**
    - [x] Barra de progresso visual reflete a porcentagem?
- [x] **Detalhes do Projeto:**
    - [x] Aba "Overview" exibe cálculo de margem (Receita vs Despesa)?
    - [x] Aba "Tasks" lista tarefas vinculadas?
    - [x] Aba "Gantt" renderiza o gráfico sem erros?
    - [x] **AI Audit:** O botão "Generate Audit" gera o texto de análise via Gemini?

## 5. RH e Tickets
**Arquivos:** `components/HRList.tsx`, `components/TicketList.tsx`

- [x] **Equipe:**
    - [x] Avatares carregam (ou mostram iniciais)?
- [x] **Tickets:**
    - [x] Chat simulado abre ao clicar em um ticket?
    - [x] É possível digitar uma resposta e ela aparecer na lista local?
- [x] **Despesas:**
    - [x] Botão "Scan Receipt" abre o modal de upload e processa via Gemini?

## 6. Inteligência Artificial (Gemini)
**Arquivos:** `services/geminiService.ts`, `components/GeminiAssistant.tsx`

- [x] **Chat Flutuante:**
    - [x] Botão abre/fecha corretamente?
    - [x] Envio de mensagem: Recebe resposta (mesmo que erro de API Key)?
- [x] **Análise Financeira:**
    - [x] No Dashboard, botão "Generate Analysis" funciona?
- [x] **Gerador de Email:**
    - [x] No Cliente, botão "Payment Reminder" gera texto?

---

## Próximos Passos (Roadmap)

1.  **Escrita Real na API:** Atualmente a maioria das ações de criação (Create Invoice, Create Project) apenas simulam sucesso ou chamam a API mas não tratam erros complexos de validação do Dolibarr.
2.  **Upload de Arquivos Real:** A função de upload de documentos precisa ser conectada ao endpoint `/documents/upload`.
3.  **Melhoria de Performance:** Implementar paginação real no servidor (atualmente carrega tudo e pagina localmente para demos pequenas).
