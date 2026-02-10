# Plano de Testes Completo - CoolGroove ERP System

## Resumo Executivo

Este plano cobre testes abrangentes do sistema ERP em **app.coolgroove.com.br**, verificando funcionalidade, responsividade e usabilidade em dispositivos mobile, tablet e desktop.

**Credenciais de Teste:**
- URL: app.coolgroove.com.br
- Usuário: tulio.silva
- Senha: 123Eumesmo!2

---

## Estratégia de Teste: Código vs Interface

### Recomendação: Abordagem Híbrida

**Fase 1 - Teste pela Interface (Recomendado Iniciar Por Aqui)**
- ✅ Teste real de usabilidade e fluxos de usuário
- ✅ Identifica problemas visuais, responsividade e UX
- ✅ Valida a experiência completa end-to-end
- ✅ Descobre bugs que podem não ser evidentes no código

**Fase 2 - Validação por Código (Quando Necessário)**
- ✅ Para investigar bugs encontrados na interface
- ✅ Para entender comportamentos complexos
- ✅ Para verificar implementação de recursos não visíveis (APIs, lógica)

**Justificativa:** O usuário final interage com a interface, não com o código. Testar pela interface garante que o sistema funciona como esperado na prática.

---

## Estrutura do Sistema (47 Rotas Identificadas)

O sistema possui **8 áreas principais** organizadas no menu lateral:

### 1. **Core Dashboard**
- Painel Principal (`/`)
- Minhas Tarefas (`/my-tasks`)
- Agenda (`/agenda`)

### 2. **Agente IA**
- WhatsApp Omni (`/whatsapp`)
- Chat Interno (`/chat`)
- Emails (`/email`)
- Automação (`/automation`)
- Espaços/Parcerias (`/venues`)
- Simulador de Eventos (`/simulator`)

### 3. **Vendas & CRM**
- Clientes (`/customers`)
- Propostas (`/proposals`)
- Pedidos de Venda (`/orders`)
- Envios (`/shipments`)
- Contratos (`/contracts`)
- Intervenções (`/interventions`)
- Chamados (`/tickets`)
- Cotação Inteligente (`/smart_quotation`)

### 4. **Financeiro**
- Faturas (`/invoices`)
- Pagamentos (`/payments`)
- Impostos e Encargos (`/tax_payments`)
- Pendências Financeiras (`/pending_payments`)

### 5. **Compras & Despesas**
- Fornecedores (`/suppliers`)
- Solicitações de Preço (`/supplier_proposals`)
- Faturas de Fornecedor (`/supplier_invoices`)
- Pagamentos de Fornecedor (`/supplier_payments`)
- Pagamentos de Despesas (`/expense_report_payments`)

### 6. **Gestão & Operacional**
- Projetos (`/projects`)
- RH & Equipe (`/hr`)
- Salários (`/salary_payments`)
- Bancos (`/bank_accounts`)
- Relatórios (`/reports`)
- Relatório Mensal IA (`/monthly-report`)

### 7. **Estoque & Produtos**
- Produtos (`/products`)
- Categorias/Tags (`/categories`)
- Estoque (`/inventory`)
- Produção (`/manufacturing`)

### 8. **Sistema**
- Atividades (`/activity`)
- Console Dev (`/development`)
- Configurações (`/settings`)

---

## Plano de Testes Detalhado

## PARTE 1: AUTENTICAÇÃO E CONFIGURAÇÃO INICIAL

### 1.1 Login e Acesso Inicial
**Desktop:**
- [ ] Acessar app.coolgroove.com.br
- [ ] Verificar exibição do SetupWizard/Login
- [ ] Inserir credenciais (tulio.silva / 123Eumesmo!2)
- [ ] Validar redirecionamento para dashboard após login
- [ ] Verificar exibição do nome do usuário no header

**Tablet:**
- [ ] Repetir processo de login
- [ ] Verificar layout responsivo do formulário de login

**Mobile:**
- [ ] Repetir processo de login
- [ ] Verificar usabilidade em tela pequena

### 1.2 Navegação Principal
**Desktop:**
- [ ] Verificar sidebar visível e expandida
- [ ] Testar todos os 8 grupos de menu
- [ ] Verificar highlight de rota ativa
- [ ] Testar botão de logout

**Tablet:**
- [ ] Verificar comportamento do sidebar (pode ser colapsável)
- [ ] Testar toggle do menu

**Mobile:**
- [ ] Sidebar deve estar oculta por padrão
- [ ] Botão hamburger deve abrir/fechar sidebar
- [ ] Sidebar deve deslizar da esquerda (-translate-x-full)
- [ ] Fechar sidebar ao clicar em item

---

## PARTE 2: DASHBOARD E WIDGETS (Rota: `/`)

### 2.1 Dashboard Principal
**Todos os Dispositivos:**
- [ ] Verificar exibição de KPIs financeiros:
  - Total Receita
  - Total Despesas
  - Saldo em Caixa
  - Pagamentos Pendentes
- [ ] Validar gráfico de fluxo de caixa (12 meses)
- [ ] Verificar projeção de 90 dias
- [ ] Validar previsão de vendas com IA (Gemini)
- [ ] Verificar "Meus Itens Pendentes"
- [ ] Validar alertas operacionais:
  - Tarefas atrasadas
  - Estoque baixo
- [ ] Verificar widget de saúde financeira (AI-powered)

**Responsividade:**
- [ ] Desktop: Grid 4 colunas para KPIs
- [ ] Tablet: Grid 2 colunas
- [ ] Mobile: Grid 1 coluna (stacked)

### 2.2 Ações Rápidas
- [ ] Botão "Criar Fatura" - abrir modal
- [ ] Botão "Adicionar Cliente" - abrir modal
- [ ] Botão "Novo Projeto" - abrir modal
- [ ] Botão "Abrir WhatsApp" - navegar para `/whatsapp`

---

## PARTE 3: HEADER E COMPONENTES GLOBAIS

### 3.1 Header
**Desktop:**
- [ ] Busca global (ícone de lupa)
- [ ] Atalho ⌘K / Ctrl+K abre busca
- [ ] Indicador de sincronização visível
- [ ] Sino de notificações com contador
- [ ] Menu de usuário (dropdown)

**Tablet:**
- [ ] Indicador de sync pode estar oculto (md:hidden)
- [ ] Demais elementos visíveis

**Mobile:**
- [ ] Botão hamburger visível
- [ ] Busca pode ser colapsada
- [ ] Notificações e user menu visíveis

### 3.2 Busca Global (GlobalSearch)
- [ ] Abrir modal com ⌘K
- [ ] Digitar termo de busca
- [ ] Verificar busca fuzzy em:
  - Clientes
  - Fornecedores
  - Projetos
  - Usuários
  - Faturas
  - Pedidos
  - Contratos
  - Tickets
  - Produtos
  - Pagamentos bancários
- [ ] Navegação com setas do teclado
- [ ] Enter para navegar ao item
- [ ] ESC para fechar
- [ ] Click fora para fechar

### 3.3 Painel de Notificações
- [ ] Clicar no sino de notificações
- [ ] Painel desliza da direita
- [ ] Verificar lista de notificações
- [ ] Botão "Marcar como lida" em cada notificação
- [ ] Botão "Marcar todas como lidas"
- [ ] Botão "Limpar tudo"
- [ ] Click em notificação navega para item relacionado
- [ ] Fechar painel

### 3.4 Assistente Virtual
- [ ] Verificar botão flutuante no canto inferior direito
- [ ] Clicar para abrir chat
- [ ] Testar input de texto
- [ ] Enviar mensagem (Enter)
- [ ] Shift+Enter para nova linha
- [ ] Testar entrada de voz (ícone de microfone)
- [ ] Testar anexo de imagem
- [ ] Testar upload de arquivo
- [ ] Verificar streaming de resposta da IA
- [ ] Fechar assistente

---

## PARTE 4: MINHAS TAREFAS (Rota: `/my-tasks`)

### 4.1 Dashboard de Tarefas
- [ ] Navegar para "Minhas Tarefas"
- [ ] Verificar lista de tarefas pessoais
- [ ] Filtros por:
  - Projeto
  - Status
  - Data
- [ ] Visualização de tarefas da equipe
- [ ] Integração com análise de tempo
- [ ] Abrir "Assistente de Tarefas" (modal IA)

**Responsividade:**
- [ ] Layout master-detail em desktop
- [ ] Layout empilhado em mobile

---

## PARTE 5: AGENDA (Rota: `/agenda`)

### 5.1 Visualização de Calendário
- [ ] Navegar para Agenda
- [ ] Verificar visualização de calendário
- [ ] Criar novo evento (botão)
- [ ] Editar evento existente (click)
- [ ] Verificar modal de detalhes do evento
- [ ] Salvar alterações
- [ ] Deletar evento

### 5.2 Navegação de Datas
- [ ] Navegar entre meses
- [ ] Selecionar data específica
- [ ] Filtros por tipo de evento (se houver)

---

## PARTE 6: WHATSAPP OMNI (Rota: `/whatsapp`)

### 6.1 Gerenciamento de Sessões
- [ ] Navegar para WhatsApp
- [ ] Verificar lista de contas/sessões
- [ ] Abrir modal de conexão (QR code)
- [ ] Verificar exibição do QR code
- [ ] Testar botões Start/Stop sessão
- [ ] Verificar indicadores de status da sessão

### 6.2 Lista de Conversas
- [ ] Verificar lista de conversas
- [ ] Filtros:
  - Todas
  - Minhas
  - Não atribuídas
- [ ] Buscar conversas (campo de busca)
- [ ] Click em conversa para abrir

### 6.3 Janela de Chat
- [ ] Verificar histórico de mensagens
- [ ] Bolhas de mensagens (enviadas/recebidas)
- [ ] Timestamps
- [ ] Status de leitura
- [ ] Preview de mídias (imagens, áudio, documentos)
- [ ] Indicador de digitação

### 6.4 Envio de Mensagens
- [ ] Input de texto
- [ ] Enviar mensagem (Enter)
- [ ] Botão de gravação de voz
- [ ] Anexar arquivo
- [ ] Emoji picker
- [ ] Comandos IA:
  - `/sys [query]`
  - `/resumo`

### 6.5 Painel de Contexto
- [ ] Verificar painel lateral com dados CRM
- [ ] Informações do cliente vinculadas
- [ ] Histórico de interações

**Responsividade:**
- [ ] Desktop: 3 painéis (contas, lista, chat)
- [ ] Tablet: 2 painéis (lista + chat)
- [ ] Mobile: 1 painel por vez (navegação entre painéis)

---

## PARTE 7: CHAT INTERNO (Rota: `/chat`)

### 7.1 Sistema de Chat
- [ ] Navegar para Chat Interno
- [ ] Verificar sidebar com lista de conversas
- [ ] Filtrar/buscar conversas
- [ ] Conversas de usuário
- [ ] Conversas de projeto
- [ ] Click para abrir conversa

### 7.2 Interface de Conversa
- [ ] Verificar histórico de mensagens
- [ ] Input de mensagem
- [ ] Enviar mensagem
- [ ] Mensagens em tempo real

**Deeplinks:**
- [ ] Testar `/chat/user/:id`
- [ ] Testar `/chat/project/:id`

---

## PARTE 8: EMAIL (Rota: `/email`)

### 8.1 Layout de Email
- [ ] Navegar para Emails
- [ ] Verificar layout de 3 painéis:
  - Lista de contas
  - Pastas (Inbox, Sent, Drafts, Trash)
  - Lista de emails
  - Painel de leitura

### 8.2 Navegação de Pastas
- [ ] Click em "Inbox"
- [ ] Click em "Sent"
- [ ] Click em "Drafts"
- [ ] Click em "Trash"

### 8.3 Lista de Emails
- [ ] Verificar lista de emails
- [ ] Click em email para visualizar
- [ ] Painel de leitura exibe HTML do email

### 8.4 Composer (Novo Email)
- [ ] Botão "Novo Email"
- [ ] Preencher campos:
  - Para
  - Assunto
  - Corpo
- [ ] Anexar arquivo
- [ ] Preview de anexo
- [ ] Remover anexo
- [ ] Assinatura auto-inserida
- [ ] Comando `/sys` (IA)
- [ ] Enviar email

### 8.5 Configurações
- [ ] Modal de configuração de conta IMAP
- [ ] Modal de configurações de armazenamento

**Responsividade:**
- [ ] Desktop: 3+ painéis
- [ ] Mobile: navegação entre painéis

---

## PARTE 9: AUTOMAÇÃO (Rota: `/automation`)

### 9.1 Scheduler Admin
- [ ] Navegar para Automação
- [ ] Verificar lista de tarefas agendadas
- [ ] Criar nova automação
- [ ] Configurar cron job
- [ ] Editar automação existente
- [ ] Deletar automação
- [ ] Verificar fila de tarefas

---

## PARTE 10: ESPAÇOS/PARCERIAS (Rota: `/venues`)

### 10.1 Lista de Venues
- [ ] Navegar para Espaços
- [ ] Verificar lista de parceiros/venues
- [ ] Buscar venue
- [ ] Criar novo venue
- [ ] Editar venue existente
- [ ] Deletar venue
- [ ] Visualizar detalhes do venue

---

## PARTE 11: SIMULADOR DE EVENTOS (Rota: `/simulator`)

### 11.1 Wizard de Simulação (4 Etapas)
- [ ] Navegar para Simulador
- [ ] **Etapa 1: Event Drivers**
  - [ ] Input de audiência estimada
  - [ ] Configurar ingressos
  - [ ] Configurar bar
  - [ ] Configurar buffet
  - [ ] Botão "Próximo"

- [ ] **Etapa 2: Negociação**
  - [ ] Input de custos
  - [ ] Divisão de receitas
  - [ ] Configurar impostos
  - [ ] Botão "Próximo"

- [ ] **Etapa 3: Break-Even**
  - [ ] Visualizar análise de ponto de equilíbrio
  - [ ] Gráficos interativos
  - [ ] Botão "Próximo"

- [ ] **Etapa 4: Resultados**
  - [ ] Dashboard de resultados
  - [ ] Extrato detalhado
  - [ ] Salvar simulação
  - [ ] Carregar simulação existente

### 11.2 Modais Especializados
- [ ] **Bar Simulator Modal**
  - [ ] Calculadora de mix de bebidas
  - [ ] Estimativa de consumo
  - [ ] Calcular custos

- [ ] **Buffet Simulator Modal**
  - [ ] Calculadora de custos de comida
  - [ ] Estimativa por pessoa
  - [ ] Calcular total

### 11.3 Gestão de Simulações
- [ ] Salvar simulação com nome
- [ ] Carregar simulação da biblioteca
- [ ] Verificar permissões (admin vs usuário)

**Responsividade:**
- [ ] Wizard responsivo em mobile
- [ ] Gráficos adaptáveis

---

## PARTE 12: CLIENTES (Rota: `/customers`)

### 12.1 Lista de Clientes
- [ ] Navegar para Clientes
- [ ] Verificar lista de clientes
- [ ] Buscar cliente
- [ ] Filtros de status
- [ ] Paginação
- [ ] Botão "Criar Cliente"

### 12.2 Criar/Editar Cliente
- [ ] Abrir modal de criação
- [ ] Preencher campos:
  - Nome
  - Email
  - Telefone
  - Endereço
  - Outros dados
- [ ] Salvar cliente
- [ ] Validar mensagens de erro

### 12.3 Detalhes do Cliente
- [ ] Click em cliente da lista
- [ ] Verificar painel de detalhes
- [ ] Tabs/seções:
  - Informações de contato
  - Objetos vinculados (faturas, pedidos, projetos)
  - Notas e documentos
  - Resumo financeiro
- [ ] Botão editar
- [ ] Botão deletar

**Deeplink:**
- [ ] Testar `/customers/:id`

---

## PARTE 13: FORNECEDORES (Rota: `/suppliers`)

### 13.1 Gestão de Fornecedores
- [ ] Navegar para Fornecedores
- [ ] Verificar lista
- [ ] Criar fornecedor
- [ ] Editar fornecedor
- [ ] Detalhes do fornecedor
- [ ] Objetos vinculados

**Deeplink:**
- [ ] Testar `/suppliers/:id`

---

## PARTE 14: PROPOSTAS COMERCIAIS (Rota: `/proposals`)

### 14.1 Lista de Propostas
- [ ] Navegar para Propostas
- [ ] Verificar lista
- [ ] Filtros de status:
  - Rascunho
  - Validada
  - Aceita
  - Rejeitada
- [ ] Criar nova proposta
- [ ] Visualizar detalhes

### 14.2 Ações em Proposta
- [ ] Editar proposta
- [ ] Validar proposta
- [ ] Aceitar proposta
- [ ] Rejeitar proposta
- [ ] Gerar PDF
- [ ] Enviar por email

**Deeplink:**
- [ ] Testar `/proposals/:id`

---

## PARTE 15: COTAÇÃO INTELIGENTE (Rota: `/smart_quotation`)

### 15.1 Wizard de Cotação com IA (4 Etapas)
- [ ] Navegar para Cotação Inteligente
- [ ] **Etapa 1: Input de Necessidades**
  - [ ] Campo de texto livre
  - [ ] Descrever necessidades em linguagem natural
  - [ ] IA parsear texto

- [ ] **Etapa 2: Identificação de Produtos**
  - [ ] IA identificar produtos mencionados
  - [ ] Matching com catálogo existente
  - [ ] Criar novos produtos (se necessário)

- [ ] **Etapa 3: Pesquisa de Preços Web**
  - [ ] IA buscar preços na web
  - [ ] Comparação de preços
  - [ ] Selecionar melhores opções

- [ ] **Etapa 4: Gerar Propostas**
  - [ ] Criar propostas para fornecedores
  - [ ] Selecionar fornecedores
  - [ ] Gerar documentos

### 15.2 Gerenciamento
- [ ] Criar novo produto no catálogo
- [ ] Criar novo fornecedor
- [ ] Salvar cotação

---

## PARTE 16: PEDIDOS DE VENDA (Rota: `/orders`)

### 16.1 Lista de Pedidos
- [ ] Navegar para Pedidos
- [ ] Verificar lista
- [ ] Filtros de status
- [ ] Criar pedido
- [ ] Visualizar detalhes

### 16.2 Workflow de Pedidos
- [ ] Validar pedido (Draft → Validated)
- [ ] Gerar fatura a partir do pedido
- [ ] Editar pedido
- [ ] Cancelar pedido

**Deeplink:**
- [ ] Testar `/orders/:id`

---

## PARTE 17: ENVIOS/ENTREGAS (Rota: `/shipments`)

### 17.1 Gestão de Envios
- [ ] Navegar para Envios
- [ ] Lista de envios
- [ ] Criar novo envio
- [ ] Rastrear envio
- [ ] Atualizar status
- [ ] Vincular a pedidos

---

## PARTE 18: CONTRATOS (Rota: `/contracts`)

### 18.1 Gestão de Contratos
- [ ] Navegar para Contratos
- [ ] Lista de contratos
- [ ] Criar contrato
- [ ] Editar contrato
- [ ] Visualizar detalhes
- [ ] Upload de documento
- [ ] Ativar/desativar contrato

---

## PARTE 19: INTERVENÇÕES (Rota: `/interventions`)

### 19.1 Serviços de Campo
- [ ] Navegar para Intervenções
- [ ] Lista de intervenções
- [ ] Criar intervenção
- [ ] Atribuir a técnico
- [ ] Atualizar status
- [ ] Registrar tempo
- [ ] Finalizar intervenção

---

## PARTE 20: CHAMADOS/TICKETS (Rota: `/tickets`)

### 20.1 Lista de Tickets
- [ ] Navegar para Chamados
- [ ] Verificar lista
- [ ] Filtros de status
- [ ] Criar ticket
- [ ] Atribuir ticket a usuário
- [ ] Visualizar detalhes

### 20.2 Detalhes do Ticket
- [ ] Informações do ticket
- [ ] Atualizar progresso
- [ ] Adicionar comentários/notas
- [ ] Upload de anexos
- [ ] Histórico de atividades
- [ ] Fechar ticket

**Deeplink:**
- [ ] Testar `/tickets/:id`

---

## PARTE 21: FATURAS DE CLIENTES (Rota: `/invoices`)

### 21.1 Lista de Faturas
- [ ] Navegar para Faturas
- [ ] Verificar lista
- [ ] Filtros de status:
  - Rascunho
  - Validada
  - Paga
  - Abandonada
- [ ] Criar fatura
- [ ] Buscar fatura
- [ ] Paginação

### 21.2 Ações em Fatura
- [ ] Validar fatura
- [ ] Registrar pagamento
- [ ] Gerar PDF
- [ ] Enviar por email
- [ ] Editar fatura (se rascunho)
- [ ] Cancelar/abandonar fatura

### 21.3 Detalhes da Fatura
- [ ] Visualizar linhas da fatura
- [ ] Ver totais
- [ ] Ver pagamentos recebidos
- [ ] Histórico

**Deeplink:**
- [ ] Testar `/invoices/:id`

---

## PARTE 22: PAGAMENTOS DE CLIENTES (Rota: `/payments`)

### 22.1 Gestão de Pagamentos
- [ ] Navegar para Pagamentos
- [ ] Lista de pagamentos
- [ ] Criar pagamento
- [ ] Modal de pagamento:
  - [ ] Valor
  - [ ] Data
  - [ ] Método de pagamento
  - [ ] Conta bancária
  - [ ] Alocar a faturas
  - [ ] Notas
- [ ] Salvar pagamento
- [ ] Visualizar detalhes

**Deeplink:**
- [ ] Testar `/payments/:id`

---

## PARTE 23: IMPOSTOS E ENCARGOS (Rota: `/tax_payments`)

### 23.1 Pagamentos de Impostos
- [ ] Navegar para Impostos
- [ ] Lista de pagamentos de impostos
- [ ] Criar pagamento de imposto
- [ ] Editar
- [ ] Visualizar detalhes

**Deeplink:**
- [ ] Testar `/tax_payments/:id`

---

## PARTE 24: PENDÊNCIAS FINANCEIRAS (Rota: `/pending_payments`)

### 24.1 Dashboard de Pendências
- [ ] Navegar para Pendências
- [ ] Verificar dashboard
- [ ] Faturas vencidas
- [ ] Pagamentos atrasados
- [ ] Valores totais
- [ ] Ações rápidas para regularizar

---

## PARTE 25: FATURAS DE FORNECEDOR (Rota: `/supplier_invoices`)

### 25.1 Gestão de Faturas de Fornecedor
- [ ] Navegar para Faturas de Fornecedor
- [ ] Lista
- [ ] Criar fatura
- [ ] Validar
- [ ] Registrar pagamento
- [ ] Detalhes

**Deeplink:**
- [ ] Testar `/supplier_invoices/:id`

---

## PARTE 26: PAGAMENTOS DE FORNECEDOR (Rota: `/supplier_payments`)

### 26.1 Gestão de Pagamentos
- [ ] Navegar para Pagamentos de Fornecedor
- [ ] Lista
- [ ] Criar pagamento
- [ ] Alocar a faturas
- [ ] Detalhes

**Deeplink:**
- [ ] Testar `/supplier_payments/:id`

---

## PARTE 27: SOLICITAÇÕES DE PREÇO (Rota: `/supplier_proposals`)

### 27.1 Gestão de Solicitações
- [ ] Navegar para Solicitações de Preço
- [ ] Lista
- [ ] Criar solicitação
- [ ] Enviar a fornecedores
- [ ] Receber respostas
- [ ] Comparar propostas
- [ ] Aprovar/rejeitar

**Deeplink:**
- [ ] Testar `/supplier_proposals/:id`

---

## PARTE 28: PAGAMENTOS DE DESPESAS (Rota: `/expense_report_payments`)

### 28.1 Reembolsos de Despesas
- [ ] Navegar para Pagamentos de Despesas
- [ ] Lista
- [ ] Criar reembolso
- [ ] Scanner de recibos (IA + OCR):
  - [ ] Camera/upload
  - [ ] Preview
  - [ ] Extração de dados
  - [ ] Auto-preencher formulário
- [ ] Aprovar despesa
- [ ] Pagar

**Deeplink:**
- [ ] Testar `/expense_report_payments/:id`

---

## PARTE 29: PROJETOS (Rota: `/projects`)

### 29.1 Lista de Projetos
- [ ] Navegar para Projetos
- [ ] Verificar lista
- [ ] Criar projeto (modal)
- [ ] Buscar projeto
- [ ] Filtros
- [ ] Visualizar detalhes

### 29.2 Detalhes do Projeto (Tabs)
- [ ] **Overview Tab**
  - [ ] Informações gerais
  - [ ] Progresso
  - [ ] Métricas

- [ ] **Tasks Tab**
  - [ ] Lista de tarefas do projeto
  - [ ] Criar tarefa
  - [ ] TaskWizard (criação em massa):
    - [ ] Input manual tabular
    - [ ] Magic Fill (IA gera tarefas)
    - [ ] Importar de outro projeto
    - [ ] Atribuir usuários
    - [ ] Atribuir participantes
    - [ ] Salvar lote
  - [ ] Editar tarefa
  - [ ] Marcar como concluída

- [ ] **Team Tab**
  - [ ] Membros da equipe
  - [ ] Adicionar membro
  - [ ] Remover membro
  - [ ] Atribuir roles

- [ ] **Tickets Tab**
  - [ ] Tickets vinculados ao projeto
  - [ ] Criar ticket

- [ ] **Chat Tab**
  - [ ] Conversa do projeto
  - [ ] Enviar mensagens

- [ ] **Documents Tab**
  - [ ] Upload de documentos
  - [ ] Download
  - [ ] Deletar

- [ ] **Sales Tab**
  - [ ] Propostas vinculadas
  - [ ] Pedidos vinculados
  - [ ] Faturas vinculadas

- [ ] **Financials Tab**
  - [ ] Receitas
  - [ ] Despesas
  - [ ] Margem
  - [ ] Fluxo financeiro

- [ ] **Events Tab**
  - [ ] Eventos/agenda do projeto

- [ ] **Debug Tab** (se admin)
  - [ ] Informações técnicas

**Deeplink:**
- [ ] Testar `/projects/:id`

---

## PARTE 30: TAREFAS GERAIS (Rota: `/tasks`)

### 30.1 Lista Global de Tarefas
- [ ] Navegar para Tarefas
- [ ] Lista de todas as tarefas
- [ ] Filtros
- [ ] Criar tarefa
- [ ] Visualizar detalhes

### 30.2 Detalhes da Tarefa
- [ ] Informações da tarefa
- [ ] Slider de progresso
- [ ] Registro de tempo:
  - [ ] Abrir TaskTimeDialog
  - [ ] Input de horas
  - [ ] Timer start/stop
  - [ ] Salvar tempo
- [ ] Comentários/notas
- [ ] Subtarefas
- [ ] Anexos de arquivo

**Deeplink:**
- [ ] Testar `/tasks/:id`

---

## PARTE 31: RH & EQUIPE (Rota: `/hr`)

### 31.1 Lista de Funcionários
- [ ] Navegar para RH
- [ ] Lista de usuários/funcionários
- [ ] Criar usuário (modal)
- [ ] Editar usuário
- [ ] Visualizar detalhes

### 31.2 Detalhes de Usuário (Tabs)
- [ ] **Informações Pessoais**
  - [ ] Dados cadastrais
  - [ ] Editar

- [ ] **Leaves (Férias/Ausências)**
  - [ ] Solicitar ausência
  - [ ] Aprovar/rejeitar
  - [ ] Histórico

- [ ] **Expenses (Despesas)**
  - [ ] Scanner de recibos (IA + OCR)
  - [ ] Criar despesa
  - [ ] Aprovar

- [ ] **Workload (Carga de Trabalho)**
  - [ ] Análise de tempo
  - [ ] Tarefas atribuídas

- [ ] **Hierarchy (Hierarquia)**
  - [ ] Organograma
  - [ ] Reporta para

- [ ] **Groups (Grupos/Times)**
  - [ ] Grupos do usuário
  - [ ] Adicionar a grupo

**Deeplink:**
- [ ] Testar `/hr/:id`

---

## PARTE 32: SALÁRIOS (Rota: `/salary_payments`)

### 32.1 Pagamentos de Salário
- [ ] Navegar para Salários
- [ ] Lista de pagamentos
- [ ] Criar pagamento de salário
- [ ] Editar
- [ ] Visualizar detalhes

**Deeplink:**
- [ ] Testar `/salary_payments/:id`

---

## PARTE 33: BANCOS (Rota: `/bank_accounts`)

### 33.1 Contas Bancárias
- [ ] Navegar para Bancos
- [ ] Lista de contas
- [ ] Criar conta
- [ ] Visualizar saldo
- [ ] Integração Itau:
  - [ ] Dashboard Itau
  - [ ] Aprovação de documentos
  - [ ] Envio de documentos
  - [ ] Sincronização de saldo
- [ ] Integração Inter:
  - [ ] Dashboard Inter
  - [ ] Funcionalidades similares
- [ ] Importar extrato bancário

---

## PARTE 34: PRODUTOS (Rota: `/products`)

### 34.1 Lista de Produtos
- [ ] Navegar para Produtos
- [ ] Verificar lista
- [ ] Filtro por tipo (produtos vs serviços)
- [ ] Criar produto
- [ ] Editar produto
- [ ] Visualizar detalhes:
  - [ ] Informações
  - [ ] Níveis de estoque
  - [ ] Preços

**Deeplink:**
- [ ] Testar `/products/:id`

### 34.2 Serviços (Rota: `/services`)
- [ ] Navegar para Serviços (filtro de produtos)
- [ ] Similar a produtos

**Deeplink:**
- [ ] Testar `/services/:id`

---

## PARTE 35: CATEGORIAS/TAGS (Rota: `/categories`)

### 35.1 Gestão de Categorias
- [ ] Navegar para Categorias
- [ ] Lista
- [ ] Criar categoria
- [ ] Editar
- [ ] Deletar
- [ ] Atribuir a produtos

---

## PARTE 36: ESTOQUE (Rota: `/inventory`)

### 36.1 Visualização de Estoque
- [ ] Navegar para Estoque
- [ ] Níveis de estoque por armazém
- [ ] Histórico de movimentações
- [ ] Alertas de estoque baixo
- [ ] Gestão de armazéns

---

## PARTE 37: PRODUÇÃO/MANUFATURA (Rota: `/manufacturing`)

### 37.1 Gestão de Produção
- [ ] Navegar para Produção
- [ ] **Tab: Bill of Materials (BOM)**
  - [ ] Lista de BOMs
  - [ ] Criar BOM (modal):
    - [ ] Produto final
    - [ ] Componentes
    - [ ] Quantidades
    - [ ] Salvar
  - [ ] Visualizar BOM em árvore
  - [ ] Editar BOM
  - [ ] Deletar BOM

- [ ] **Tab: Manufacturing Orders (MO)**
  - [ ] Lista de ordens
  - [ ] Criar MO (modal):
    - [ ] Selecionar BOM
    - [ ] Quantidade
    - [ ] Data
    - [ ] Salvar
  - [ ] Detalhes do MO:
    - [ ] Etapas de produção
    - [ ] Consumir estoque (modal)
    - [ ] Produzir itens (modal)
    - [ ] Finalizar ordem

---

## PARTE 38: RELATÓRIOS (Rota: `/reports`)

### 38.1 Visualização de Relatórios
- [ ] Navegar para Relatórios
- [ ] **Tab: Finance**
  - [ ] Gráficos financeiros
  - [ ] Métricas
  - [ ] Exportar PDF/Excel

- [ ] **Tab: HR**
  - [ ] Relatórios de RH
  - [ ] Análise de equipe

- [ ] **Tab: Projects**
  - [ ] Status de projetos
  - [ ] Performance

- [ ] **Tab: Sales**
  - [ ] Vendas por período
  - [ ] Top clientes

---

## PARTE 39: RELATÓRIO MENSAL IA (Rota: `/monthly-report`)

### 39.1 Relatório Gerado por IA
- [ ] Navegar para Relatório Mensal
- [ ] Verificar análise mensal gerada por IA
- [ ] Métricas e insights
- [ ] Exportar relatório

---

## PARTE 40: ATIVIDADES (Rota: `/activity`)

### 40.1 Log de Atividades
- [ ] Navegar para Atividades
- [ ] Verificar histórico
- [ ] Filtrar por:
  - Usuário
  - Tipo de ação
  - Data
- [ ] Visualizar detalhes de atividade

---

## PARTE 41: CONSOLE DE DESENVOLVIMENTO (Rota: `/development`)

### 41.1 Ferramentas de Desenvolvimento
- [ ] Navegar para Console Dev
- [ ] **Tab: Logs**
  - [ ] Visualizar logs do sistema

- [ ] **Tab: Audit**
  - [ ] Auditoria de mudanças

- [ ] **Tab: Monitor**
  - [ ] Monitoramento de sistema

- [ ] **Tab: Playground**
  - [ ] Área de testes

- [ ] **Tab: Permissions**
  - [ ] Gestão de permissões

- [ ] **Tab: AI Fix**
  - [ ] Ferramentas de correção com IA

- [ ] **Tab: Codegen**
  - [ ] Geração de código

- [ ] **Tab: Optimize**
  - [ ] Otimizações

- [ ] **Tab: LLM Settings**
  - [ ] Configurações de modelos de IA

---

## PARTE 42: TESTES DE RESPONSIVIDADE GLOBAL

### 42.1 Breakpoints Principais
Testar TODAS as páginas visitadas nos seguintes breakpoints:

**Mobile:**
- [ ] 375px (iPhone SE)
- [ ] 390px (iPhone 12/13)
- [ ] 414px (iPhone Plus)

**Tablet:**
- [ ] 768px (iPad Portrait)
- [ ] 1024px (iPad Landscape)

**Desktop:**
- [ ] 1280px (Laptop)
- [ ] 1920px (Full HD)
- [ ] 2560px (2K)

### 42.2 Elementos a Verificar em Cada Breakpoint
- [ ] Sidebar comportamento (visível/oculto/colapsável)
- [ ] Header layout
- [ ] Grids de KPIs/cards
- [ ] Tabelas (scroll horizontal se necessário)
- [ ] Modais (width adaptável)
- [ ] Formulários (campos empilhados)
- [ ] Botões (tamanho adequado para toque)
- [ ] Navegação (hamburger em mobile)
- [ ] Gráficos (responsivos)

---

## PARTE 43: TESTES DE ACESSIBILIDADE

### 43.1 Navegação por Teclado
- [ ] Tab através de elementos focáveis
- [ ] Enter/Space em botões e links
- [ ] Escape fecha modais
- [ ] Setas em listas e autocomplete

### 43.2 ARIA e Semântica
- [ ] Labels em inputs
- [ ] Roles apropriados
- [ ] Estados de erro com aria-invalid
- [ ] Descrições com aria-describedby

### 43.3 Contraste e Dark Mode
- [ ] Verificar contraste de texto
- [ ] Testar dark mode (se disponível):
  - [ ] Toggle dark mode
  - [ ] Verificar todas as páginas em dark mode

---

## PARTE 44: TESTES DE INTEGRAÇÃO IA

### 44.1 Funcionalidades Powered by IA
- [ ] Virtual Assistant (chat geral)
- [ ] SmartQuotationWizard (cotação inteligente)
- [ ] TaskWizard Magic Fill (geração de tarefas)
- [ ] Receipt Scanner (OCR de recibos)
- [ ] Financial Forecast (previsão com Gemini)
- [ ] Monthly Report (relatório mensal IA)
- [ ] Email/WhatsApp commands (`/sys`, `/resumo`)
- [ ] Financial Health Widget (insights)

### 44.2 Validar para Cada Feature IA
- [ ] Input de dados funciona
- [ ] Loading state exibido
- [ ] Resposta da IA exibida corretamente
- [ ] Tratamento de erros
- [ ] Possibilidade de editar resultado

---

## PARTE 45: TESTES DE INTEGRAÇÃO BANCÁRIA

### 45.1 Banco Itau
- [ ] Navegar para dashboard Itau
- [ ] Verificar saldo
- [ ] Workflow de aprovação
- [ ] Envio de documentos (modal)
- [ ] Sincronização de transações

### 45.2 Banco Inter
- [ ] Navegar para dashboard Inter
- [ ] Funcionalidades similares

---

## PARTE 46: TESTES DE FLUXOS COMPLETOS (End-to-End)

### 46.1 Fluxo de Venda Completo
1. [ ] Criar cliente
2. [ ] Criar proposta para cliente
3. [ ] Validar proposta
4. [ ] Converter em pedido
5. [ ] Validar pedido
6. [ ] Gerar fatura
7. [ ] Registrar pagamento
8. [ ] Verificar saldo em caixa atualizado

### 46.2 Fluxo de Compra Completo
1. [ ] Criar fornecedor
2. [ ] Criar solicitação de preço
3. [ ] Receber proposta
4. [ ] Aprovar
5. [ ] Criar fatura de fornecedor
6. [ ] Registrar pagamento
7. [ ] Verificar despesa no dashboard

### 46.3 Fluxo de Projeto Completo
1. [ ] Criar projeto
2. [ ] Adicionar tarefas (TaskWizard)
3. [ ] Atribuir equipe
4. [ ] Registrar tempo em tarefas
5. [ ] Criar tickets vinculados
6. [ ] Vincular proposta/pedido
7. [ ] Acompanhar financeiro
8. [ ] Marcar projeto como concluído

### 46.4 Fluxo de WhatsApp Completo
1. [ ] Conectar sessão (QR code)
2. [ ] Receber mensagem
3. [ ] Atribuir conversa a usuário
4. [ ] Responder mensagem
5. [ ] Usar comando `/resumo`
6. [ ] Verificar contexto CRM
7. [ ] Vincular a cliente/projeto

### 46.5 Fluxo de Despesas Completo
1. [ ] Funcionário escaneia recibo (móvel)
2. [ ] IA extrai dados
3. [ ] Submeter despesa
4. [ ] Gestor aprovar
5. [ ] Criar reembolso
6. [ ] Pagar

### 46.6 Fluxo de Produção Completo
1. [ ] Criar BOM
2. [ ] Criar Manufacturing Order
3. [ ] Consumir matérias-primas
4. [ ] Produzir item final
5. [ ] Verificar estoque atualizado

---

## PARTE 47: TESTES DE PERFORMANCE

### 47.1 Métricas de Carregamento
- [ ] Tempo de login
- [ ] Tempo de carregamento do dashboard
- [ ] Tempo de transição entre páginas
- [ ] Tempo de abertura de modais
- [ ] Tempo de resposta de busca global

### 47.2 Responsividade da Interface
- [ ] Scroll suave
- [ ] Animações sem lag
- [ ] Sem flash de conteúdo não estilizado (FOUC)

---

## PARTE 48: TESTES DE NOTIFICAÇÕES

### 48.1 Sistema de Notificações
- [ ] Receber notificação em tempo real
- [ ] Contador atualizado
- [ ] Click em notificação navega corretamente
- [ ] Marcar como lida funciona
- [ ] Limpar todas funciona

### 48.2 Toast Notifications (Sonner)
- [ ] Sucesso ao criar item
- [ ] Erro ao falhar operação
- [ ] Loading ao processar
- [ ] Warning para alertas
- [ ] Auto-dismiss após timeout
- [ ] Posicionamento correto (top-right)

---

## PARTE 49: TESTES DE PERMISSÕES

### 49.1 Controle de Acesso
- [ ] Login com usuário admin
  - [ ] Verificar acesso a todas as áreas
  - [ ] Console Dev visível

- [ ] Login com usuário regular (criar se necessário)
  - [ ] Verificar restrições de acesso
  - [ ] Menu filtrado por permissões
  - [ ] Botões de ação restritos

### 49.2 Sidebar Filtering
- [ ] Itens de menu baseados em:
  - [ ] Módulos ativos
  - [ ] Permissões do usuário
  - [ ] Admin override

---

## PARTE 50: TESTES DE LOGOUT E RE-LOGIN

### 50.1 Logout
- [ ] Click no menu de usuário
- [ ] Click em "Logout"
- [ ] Redirecionamento para login
- [ ] Sessão encerrada

### 50.2 Re-login
- [ ] Fazer login novamente
- [ ] Verificar persistência de dados
- [ ] Retornar à última página (se aplicável)

---

## PARTE 51: CRIAÇÃO DE DADOS DE TESTE

Durante os testes, CRIAR (não deletar ainda):
- [ ] 2-3 clientes novos
- [ ] 2-3 fornecedores
- [ ] 1 projeto completo com tarefas
- [ ] 1 proposta
- [ ] 1 pedido
- [ ] 1 fatura
- [ ] 1 ticket
- [ ] 1 produto
- [ ] Mensagens em WhatsApp e Chat
- [ ] 1 simulação de evento
- [ ] 1 BOM e 1 MO
- [ ] Despesas com recibos escaneados

**Objetivo:** Ter dados suficientes para testar listagens, detalhes, edições e relatórios.

---

## PARTE 52: DOCUMENTAÇÃO DE BUGS E PROBLEMAS

Para cada problema encontrado, documentar:
- [ ] Página/rota onde ocorreu
- [ ] Dispositivo/breakpoint
- [ ] Passos para reproduzir
- [ ] Comportamento esperado
- [ ] Comportamento observado
- [ ] Screenshot (se visual)
- [ ] Severidade (crítico, alto, médio, baixo)

---

## VERIFICAÇÃO FINAL

### Checklist de Conclusão
- [ ] Todas as 47 rotas testadas
- [ ] Desktop, tablet e mobile testados
- [ ] Todos os botões e ações clicados
- [ ] Modais e formulários validados
- [ ] Deeplinks funcionando
- [ ] Responsividade validada
- [ ] Features IA testadas
- [ ] Fluxos E2E completos
- [ ] Dados de teste criados
- [ ] Bugs documentados

---

## ARQUIVOS CRÍTICOS IDENTIFICADOS

Para referência durante investigação de bugs:

**Layout & Navegação:**
- [src/components/App.tsx](src/components/App.tsx) - Definição de rotas
- [src/components/Layout/Sidebar.tsx](src/components/Layout/Sidebar.tsx) - Menu lateral
- [src/components/Layout/MainLayout.tsx](src/components/Layout/MainLayout.tsx) - Layout principal
- [src/components/Layout/Header.tsx](src/components/Layout/Header.tsx) - Cabeçalho

**Responsividade:**
- [src/components/ui/MasterDetailLayout.tsx](src/components/ui/MasterDetailLayout.tsx) - Padrão master-detail responsivo
- [src/components/common/GenericListLayout.tsx](src/components/common/GenericListLayout.tsx) - Layout genérico

**Dashboards:**
- [src/components/Dashboard.tsx](src/components/Dashboard.tsx) - Dashboard principal
- [src/components/Tasks/UserTaskDashboard.tsx](src/components/Tasks/UserTaskDashboard.tsx) - Dashboard de tarefas

**IA & Automação:**
- [src/components/VirtualAssistant.tsx](src/components/VirtualAssistant.tsx) - Assistente virtual
- [src/components/SmartQuotationWizard.tsx](src/components/SmartQuotationWizard.tsx) - Cotação inteligente
- [src/components/Projects/TaskWizard.tsx](src/components/Projects/TaskWizard.tsx) - Wizard de tarefas
- [src/components/Finance/ReceiptScanner.tsx](src/components/Finance/ReceiptScanner.tsx) - Scanner de recibos

**Comunicação:**
- [src/components/WhatsAppView.tsx](src/components/WhatsAppView.tsx) - WhatsApp
- [src/components/Email/EmailView.tsx](src/components/Email/EmailView.tsx) - Email
- [src/pages/ChatPage.tsx](src/pages/ChatPage.tsx) - Chat interno

**Contexto & State:**
- [src/context/DolibarrContext.tsx](src/context/DolibarrContext.tsx) - Contexto global, permissões

**Utilitários:**
- [src/utils/navigationUtils.ts](src/utils/navigationUtils.ts) - Navegação e deeplinks

---

## PRÓXIMOS PASSOS

1. **Executar testes pela interface** (app.coolgroove.com.br)
2. **Documentar todos os bugs encontrados**
3. **Criar relatório final de testes**
4. **Priorizar bugs por severidade**
5. **Fase 2: Investigar bugs no código** (se necessário)
6. **Fase 3: Correções** (após aprovação do usuário)

