# Plano de Integração: sistemav2 ↔ Moltbot

**Data:** 2026-02-14
**Status:** Planejamento
**Autor:** Claude Code

---

## 1. Sumário Executivo

Este documento descreve o plano para integrar o **sistemav2** (Coolgroove) com o **Moltbot/OpenClaw**, permitindo:

- Conexão WhatsApp mais robusta via gateway Moltbot
- Persistência de histórico no Brain Hub (Tulipa)
- Orquestração de tarefas com DAG
- Memory search com embeddings semânticos
- Unificação de canais de comunicação

### Decisão Arquitetural

**Opção escolhida:** Moltbot como Gateway Principal (Opção A)

O sistemav2 utilizará o Moltbot Gateway como backend de WhatsApp, substituindo gradualmente o whatsapp-web.js direto. Isso permite aproveitar a infraestrutura já testada do Moltbot enquanto mantém as funcionalidades específicas do sistemav2.

---

## 2. Arquitetura Atual

### 2.1 sistemav2 (Coolgroove)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SISTEMAV2 BACKEND (Express)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐   │
│  │ whatsappRoutes  │───►│  sessionService  │───►│  whatsapp-web.js    │   │
│  │   (API REST)    │    │   (Multi-sessão) │    │   (Puppeteer)       │   │
│  └────────┬────────┘    └──────────────────┘    └─────────────────────┘   │
│           │                                                                 │
│  ┌────────▼────────┐    ┌──────────────────┐    ┌─────────────────────┐   │
│  │  messageService │───►│   storeService   │───►│  JSON Persistence   │   │
│  │  (Send/Receive) │    │   (Settings)     │    │                     │   │
│  └────────┬────────┘    └──────────────────┘    └─────────────────────┘   │
│           │                                                                 │
│  ┌────────▼────────┐    ┌──────────────────┐    ┌─────────────────────┐   │
│  │   botService    │───►│   aiService      │───►│  Google GenAI       │   │
│  │  (Auto-Reply)   │    │   (LLM/STT)      │    │  (Gemini)           │   │
│  └─────────────────┘    └──────────────────┘    └─────────────────────┘   │
│                                                                             │
│  ┌─────────────────┐    ┌──────────────────┐                               │
│  │ schedulerService│───►│  dolibarrService │ ◄── CRM Integration          │
│  │ (Automation)    │    │  (ERP)           │                               │
│  └─────────────────┘    └──────────────────┘                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Características:**
- whatsapp-web.js via Puppeteer (conexão direta)
- Multi-sessão com persistência em `.wwebjs_auth/`
- Bot com LLM (Gemini) para auto-resposta
- Integração CRM Dolibarr
- Scheduler para automações
- Socket.IO para real-time

### 2.2 Moltbot/OpenClaw (Tulipa)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     MOLTBOT GATEWAY (porta 18789)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐   │
│  │ Plugin System   │───►│ tulipa-listener  │───►│ Brain Hub           │   │
│  │ (Hooks)         │    │ (Capture)        │    │ (JSONL/JSON)        │   │
│  └─────────────────┘    └──────────────────┘    └─────────────────────┘   │
│                                                                             │
│  ┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐   │
│  │ Channels        │───►│ WhatsApp         │    │ Email               │   │
│  │ (Multi-canal)   │    │ Telegram         │    │ SMS                 │   │
│  └─────────────────┘    └──────────────────┘    └─────────────────────┘   │
│                                                                             │
│  ┌─────────────────┐    ┌──────────────────┐                               │
│  │ Memory Search   │───►│ Embeddings       │ ◄── Vector + BM25 Hybrid    │
│  │ (Semântico)     │    │ (OpenAI/Gemini)  │                               │
│  └─────────────────┘    └──────────────────┘                               │
│                                                                             │
│  ┌─────────────────┐                                                        │
│  │ Cron Jobs       │ ◄── Processamento batch (sessões isoladas)            │
│  └─────────────────┘                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                      TULIPA SERVER (porta 8081)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐   │
│  │ Task Pipeline   │───►│ DAG Orchestrator │───►│ Wave Execution      │   │
│  │ (CRUD)          │    │ (Dependencies)   │    │ (Parallelism)       │   │
│  └─────────────────┘    └──────────────────┘    └─────────────────────┘   │
│                                                                             │
│  ┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐   │
│  │ Brain Hub API   │───►│ Events           │    │ People Index        │   │
│  │ (/api/brain/*)  │    │ (JSONL diário)   │    │ (JSON profiles)     │   │
│  └─────────────────┘    └──────────────────┘    └─────────────────────┘   │
│                                                                             │
│  ┌─────────────────┐    ┌──────────────────┐                               │
│  │ Agent Registry  │───►│ Subagent Control │ ◄── Moltbot sessions         │
│  │ (/api/agents/*) │    │ (Lifecycle)      │                               │
│  └─────────────────┘    └──────────────────┘                               │
│                                                                             │
│  ┌─────────────────┐                                                        │
│  │ SQLite DB       │ ◄── tulipa.db (entities, relations, tasks)            │
│  └─────────────────┘                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Características:**
- Gateway multi-canal (WhatsApp, Email, Telegram)
- Sistema de plugins extensível
- Brain Hub para persistência de eventos
- Memory search com embeddings
- Orquestração DAG de tarefas
- Cron jobs para processamento batch

---

## 3. Arquitetura Proposta (Pós-Integração)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (React/Vite)                              │
│                        sistemav2 UI Components                              │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      SISTEMAV2 BACKEND (Express)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    NOVA CAMADA: Integration Layer                    │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │   │
│  │  │ moltbotGateway  │  │ tulipaService   │  │ channelRouter       │  │   │
│  │  │ (WhatsApp API)  │  │ (Brain/Tasks)   │  │ (Unified Channels)  │  │   │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐   │
│  │ whatsappRoutes  │───►│  Adapter Layer   │───►│  Legacy/New Switch  │   │
│  │ (Mantido)       │    │  (Compatibilidade)│    │  (Feature Flags)   │   │
│  └─────────────────┘    └──────────────────┘    └─────────────────────┘   │
│                                                                             │
│  ┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐   │
│  │   botService    │───►│   aiService      │───►│  Gemini (mantido)   │   │
│  │  (Adaptado)     │    │   (Mantido)      │    │                     │   │
│  └─────────────────┘    └──────────────────┘    └─────────────────────┘   │
│                                                                             │
│  ┌─────────────────┐    ┌──────────────────┐                               │
│  │ schedulerService│───►│  dolibarrService │ ◄── CRM (mantido)            │
│  │ (Mantido)       │    │  (Mantido)       │                               │
│  └─────────────────┘    └──────────────────┘                               │
│                                                                             │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
┌───────────────────────────────┐   ┌───────────────────────────────────────┐
│   MOLTBOT GATEWAY (18789)     │   │        TULIPA SERVER (8081)           │
├───────────────────────────────┤   ├───────────────────────────────────────┤
│                               │   │                                       │
│  • WhatsApp Connection        │   │  • Brain Hub (eventos, pessoas)       │
│  • Message Send/Receive       │   │  • Task Orchestration                 │
│  • Status & QR Code           │   │  • Agent Registry                     │
│  • tulipa-listener plugin     │◄──┤  • Memory Search                      │
│                               │   │  • Analytics                          │
│                               │   │                                       │
└───────────────────────────────┘   └───────────────────────────────────────┘
```

---

## 4. Componentes a Implementar

### 4.1 Integration Layer (Novos Serviços)

#### 4.1.1 `moltbotGateway.ts`

Serviço para comunicação com o Gateway Moltbot.

```typescript
// backend/src/services/moltbotGateway.ts

interface MoltbotConfig {
    host: string;           // localhost
    port: number;           // 18789
    token: string;          // API token
    timeout: number;        // Request timeout (ms)
}

interface WhatsAppStatus {
    connected: boolean;
    status: 'ready' | 'connecting' | 'disconnected' | 'error';
    phone: string | null;
    uptime: number;
}

interface SendMessageParams {
    chatId: string;
    text: string;
    sessionId?: string;
}

interface SendFileParams {
    chatId: string;
    file: Buffer;
    filename: string;
    caption?: string;
    sessionId?: string;
}

class MoltbotGateway {
    private config: MoltbotConfig;

    constructor(config?: Partial<MoltbotConfig>);

    // Status
    async getStatus(): Promise<WhatsAppStatus>;
    async getChannels(): Promise<Channel[]>;

    // Messaging
    async sendMessage(params: SendMessageParams): Promise<MessageResult>;
    async sendFile(params: SendFileParams): Promise<MessageResult>;
    async sendVoice(chatId: string, audioData: string): Promise<MessageResult>;

    // Chats
    async getChats(sessionId?: string): Promise<Chat[]>;
    async getMessages(chatId: string, limit?: number): Promise<Message[]>;

    // Session Management
    async startSession(sessionId: string): Promise<void>;
    async stopSession(sessionId: string): Promise<void>;
    async getQRCode(sessionId: string): Promise<string | null>;

    // Low-level
    private async callAPI(path: string, method?: string, body?: any): Promise<any>;
}

export const moltbotGateway = new MoltbotGateway();
```

#### 4.1.2 `tulipaService.ts`

Serviço para comunicação com o Tulipa Server.

```typescript
// backend/src/services/tulipaService.ts

interface TulipaConfig {
    host: string;           // localhost
    port: number;           // 8081
    timeout: number;        // Request timeout (ms)
}

interface BrainPerson {
    id: string;
    name: string;
    phone?: string;
    email?: string;
    firstSeen: string;
    lastSeen: string;
    messageCount: number;
    channels: string[];
    tags?: string[];
    notes?: string;
}

interface BrainEvent {
    id: string;
    timestamp: string;
    source: 'whatsapp' | 'email' | 'telegram';
    sender: string;
    senderName?: string;
    content: string;
    mediaType: 'text' | 'image' | 'audio' | 'video' | 'document';
    chatId: string;
    isGroup: boolean;
}

interface Task {
    id: string;
    name: string;
    description?: string;
    status: 'pending' | 'ready' | 'claimed' | 'running' | 'completed' | 'failed';
    priority: 'low' | 'medium' | 'high' | 'critical';
    projectId?: string;
    dependencies?: string[];
    output?: any;
    error?: string;
    createdAt: number;
    completedAt?: number;
}

class TulipaService {
    private config: TulipaConfig;

    constructor(config?: Partial<TulipaConfig>);

    // Brain Hub - People
    async getPeople(): Promise<BrainPerson[]>;
    async getPerson(id: string): Promise<BrainPerson | null>;
    async updatePerson(id: string, data: Partial<BrainPerson>): Promise<void>;
    async linkPersonToCustomer(personId: string, customerId: string): Promise<void>;

    // Brain Hub - Events
    async getEvents(date?: string): Promise<BrainEvent[]>;
    async getEventsByPerson(personId: string, limit?: number): Promise<BrainEvent[]>;
    async getEventsStats(): Promise<EventStats>;

    // Tasks
    async getTasks(projectId?: string): Promise<Task[]>;
    async getTask(id: string): Promise<Task | null>;
    async createTask(task: Partial<Task>): Promise<Task>;
    async claimTask(taskId: string, agentId: string): Promise<void>;
    async completeTask(taskId: string, output: any): Promise<void>;
    async failTask(taskId: string, error: string): Promise<void>;

    // Status
    async getSystemStatus(): Promise<SystemStatus>;
    async getWhatsAppStatus(): Promise<WhatsAppStatus>;

    // Low-level
    private async callAPI(path: string, method?: string, body?: any): Promise<any>;
}

export const tulipaService = new TulipaService();
```

#### 4.1.3 `channelRouter.ts`

Roteador unificado de canais.

```typescript
// backend/src/services/channelRouter.ts

type Channel = 'whatsapp' | 'email' | 'sms';

interface MessagePayload {
    channel: Channel;
    recipient: string;      // Phone, email, etc.
    content: string;
    mediaUrl?: string;
    mediaType?: string;
    metadata?: Record<string, any>;
}

interface ChannelConfig {
    whatsapp: {
        provider: 'legacy' | 'moltbot';  // Feature flag
        sessionId: string;
    };
    email: {
        accountId: string;
    };
}

class ChannelRouter {
    private config: ChannelConfig;

    constructor();

    // Unified send
    async send(payload: MessagePayload): Promise<SendResult>;

    // Channel-specific
    async sendWhatsApp(recipient: string, content: string, sessionId?: string): Promise<SendResult>;
    async sendEmail(recipient: string, subject: string, body: string): Promise<SendResult>;

    // Feature flag: Use legacy (whatsapp-web.js) or new (moltbot)
    setWhatsAppProvider(provider: 'legacy' | 'moltbot'): void;
    getWhatsAppProvider(): 'legacy' | 'moltbot';
}

export const channelRouter = new ChannelRouter();
```

### 4.2 Adapter Layer (Compatibilidade)

Para manter compatibilidade com o código existente durante a migração:

```typescript
// backend/src/services/adapters/messageServiceAdapter.ts

import { messageService as legacyMessageService } from '../messageService';
import { moltbotGateway } from '../moltbotGateway';
import { channelRouter } from '../channelRouter';

/**
 * Adapter que mantém a interface do messageService original
 * mas pode rotear para Moltbot quando configurado
 */
class MessageServiceAdapter {
    async sendText(sessionId: string, chatId: string, text: string) {
        if (channelRouter.getWhatsAppProvider() === 'moltbot') {
            return moltbotGateway.sendMessage({ chatId, text, sessionId });
        }
        return legacyMessageService.sendText(sessionId, chatId, text);
    }

    async sendFile(sessionId: string, chatId: string, fileData: string, filename: string, caption?: string) {
        if (channelRouter.getWhatsAppProvider() === 'moltbot') {
            const buffer = Buffer.from(fileData.split(',')[1], 'base64');
            return moltbotGateway.sendFile({ chatId, file: buffer, filename, caption, sessionId });
        }
        return legacyMessageService.sendFile(sessionId, chatId, fileData, filename, caption);
    }

    async getChats(sessionId: string) {
        if (channelRouter.getWhatsAppProvider() === 'moltbot') {
            return moltbotGateway.getChats(sessionId);
        }
        return legacyMessageService.getChats(sessionId);
    }

    async getMessages(sessionId: string, chatId: string, limit: number = 50) {
        if (channelRouter.getWhatsAppProvider() === 'moltbot') {
            return moltbotGateway.getMessages(chatId, limit);
        }
        return legacyMessageService.getMessages(sessionId, chatId, limit);
    }
}

export const messageServiceAdapter = new MessageServiceAdapter();
```

---

## 5. Configuração do Moltbot

### 5.1 Variáveis de Ambiente

Adicionar ao `.env` do sistemav2:

```env
# Moltbot Gateway
MOLTBOT_ENABLED=true
MOLTBOT_HOST=localhost
MOLTBOT_PORT=18789
MOLTBOT_TOKEN=your-gateway-token-here

# Tulipa Server
TULIPA_ENABLED=true
TULIPA_HOST=localhost
TULIPA_PORT=8081

# Feature Flags
WHATSAPP_PROVIDER=legacy    # 'legacy' ou 'moltbot'
SYNC_BRAIN_ENABLED=true     # Sincronizar eventos com Brain Hub
```

### 5.2 Configuração do tulipa-listener

O plugin `tulipa-listener` já está configurado no Moltbot. Verificar em:

**Arquivo:** `~/.clawdbot/extensions/tulipa-listener/moltbot.plugin.json`

```json
{
  "name": "tulipa-listener",
  "version": "1.0.0",
  "description": "Capture messages for Tulipa Brain Hub",
  "main": "index.ts",
  "hooks": {
    "message_received": {
      "priority": 10,
      "async": true
    },
    "message_sending": {
      "priority": 5
    },
    "before_agent_start": {
      "priority": 1
    }
  }
}
```

**Configuração no Moltbot:** `~/.openclaw/openclaw.json`

```json5
{
  "plugins": {
    "entries": {
      "tulipa-listener": {
        "enabled": true,
        "config": {
          "enabled": true,
          "brainPath": "C:/Users/tcstu/clawd/brain",
          "silentContacts": [],
          "collectAll": true
        }
      }
    }
  }
}
```

---

## 6. Sincronização de Dados

### 6.1 Brain Hub ↔ Dolibarr

Sincronizar pessoas do Brain Hub com clientes Dolibarr:

```typescript
// backend/src/services/syncService.ts

import { tulipaService } from './tulipaService';
import { dolibarrService } from './dolibarrService';

class SyncService {
    /**
     * Sincroniza pessoas do Brain Hub com clientes Dolibarr
     * Executar periodicamente via cron
     */
    async syncPeopleWithCustomers(): Promise<SyncResult> {
        const people = await tulipaService.getPeople();
        const customers = await dolibarrService.getCustomers();

        const results = {
            linked: 0,
            created: 0,
            updated: 0,
            errors: 0
        };

        for (const person of people) {
            try {
                // Buscar cliente por telefone
                const phone = person.phone?.replace(/\D/g, '');
                if (!phone) continue;

                const customer = customers.find(c =>
                    c.phone?.replace(/\D/g, '') === phone ||
                    c.phone_mobile?.replace(/\D/g, '') === phone
                );

                if (customer) {
                    // Linkar pessoa ao cliente existente
                    await tulipaService.linkPersonToCustomer(person.id, customer.id);
                    results.linked++;
                } else {
                    // Opcional: criar cliente no Dolibarr
                    // await dolibarrService.createThirdParty({ ... });
                    // results.created++;
                }
            } catch (error) {
                results.errors++;
            }
        }

        return results;
    }

    /**
     * Sincroniza eventos do Brain Hub com histórico do CRM
     */
    async syncEventsWithCRM(date: string): Promise<void> {
        const events = await tulipaService.getEvents(date);

        for (const event of events) {
            // Criar evento/atividade no Dolibarr vinculado ao cliente
            const phone = event.sender.replace(/\D/g, '');
            const customer = await dolibarrService.getThirdPartyByPhone(phone);

            if (customer) {
                // Registrar interação
                // await dolibarrService.createEvent({ ... });
            }
        }
    }
}

export const syncService = new SyncService();
```

### 6.2 Cron Job para Sincronização

Adicionar ao `schedulerService.ts`:

```typescript
// Sync Brain Hub → Dolibarr diariamente às 4am
schedulerService.addCronJob({
    name: 'sync-brain-dolibarr',
    cron: '0 4 * * *',
    handler: async () => {
        console.log('[Sync] Starting Brain Hub → Dolibarr sync...');
        const result = await syncService.syncPeopleWithCustomers();
        console.log('[Sync] Completed:', result);
    }
});
```

---

## 7. Migração Gradual

### 7.1 Fases de Migração

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           TIMELINE DE MIGRAÇÃO                              │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  FASE 1: Preparação (1 semana)                                             │
│  ├── Criar moltbotGateway.ts                                               │
│  ├── Criar tulipaService.ts                                                │
│  ├── Criar channelRouter.ts                                                │
│  └── Adicionar variáveis de ambiente                                       │
│                                                                            │
│  FASE 2: Integração Read-Only (1 semana)                                   │
│  ├── Implementar leitura de status do Moltbot                              │
│  ├── Implementar leitura de eventos do Brain Hub                           │
│  ├── Dashboard mostra dados de ambas as fontes                             │
│  └── Testar conexão e debug                                                │
│                                                                            │
│  FASE 3: Escrita Dual (2 semanas)                                          │
│  ├── MessageServiceAdapter com feature flag                                │
│  ├── Enviar mensagens via Moltbot (flag: WHATSAPP_PROVIDER=moltbot)       │
│  ├── Manter fallback para legacy                                           │
│  └── Monitorar erros e performance                                         │
│                                                                            │
│  FASE 4: Sincronização (1 semana)                                          │
│  ├── Implementar syncService                                               │
│  ├── Cron jobs para sync Brain ↔ Dolibarr                                 │
│  ├── UI para visualizar pessoas do Brain                                   │
│  └── Testar fluxo completo                                                 │
│                                                                            │
│  FASE 5: Deprecação Legacy (2 semanas)                                     │
│  ├── Mover 100% para Moltbot (WHATSAPP_PROVIDER=moltbot)                  │
│  ├── Remover whatsapp-web.js do sistemav2                                  │
│  ├── Documentar nova arquitetura                                           │
│  └── Cleanup código legado                                                 │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Feature Flags

```typescript
// backend/src/config/features.ts

export const FEATURES = {
    // WhatsApp provider: 'legacy' (whatsapp-web.js) ou 'moltbot'
    WHATSAPP_PROVIDER: process.env.WHATSAPP_PROVIDER || 'legacy',

    // Sincronizar eventos com Brain Hub
    SYNC_BRAIN_ENABLED: process.env.SYNC_BRAIN_ENABLED === 'true',

    // Usar Tulipa para orquestração de tarefas
    TULIPA_TASKS_ENABLED: process.env.TULIPA_TASKS_ENABLED === 'true',

    // Memory search via Tulipa
    MEMORY_SEARCH_ENABLED: process.env.MEMORY_SEARCH_ENABLED === 'true',
};

export function isUsingMoltbot(): boolean {
    return FEATURES.WHATSAPP_PROVIDER === 'moltbot';
}
```

---

## 8. Endpoints da API

### 8.1 Moltbot Gateway (porta 18789)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/status` | Status geral do gateway |
| GET | `/api/channels` | Lista de canais disponíveis |
| GET | `/api/whatsapp/status` | Status do WhatsApp |
| POST | `/api/whatsapp/send` | Enviar mensagem |
| GET | `/api/whatsapp/chats` | Listar conversas |
| GET | `/api/whatsapp/messages/:chatId` | Histórico de mensagens |

### 8.2 Tulipa Server (porta 8081)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/status` | Health check completo |
| GET | `/api/status/quick` | Health check rápido |
| GET | `/api/whatsapp/status` | Status WhatsApp (via gateway) |
| GET | `/api/brain/people` | Listar pessoas |
| GET | `/api/brain/events` | Listar eventos |
| GET | `/api/brain/events/stats` | Estatísticas de eventos |
| GET | `/api/tasks` | Listar tarefas |
| POST | `/api/tasks` | Criar tarefa |
| POST | `/api/tasks/:id/claim` | Reivindicar tarefa |
| POST | `/api/tasks/:id/complete` | Completar tarefa |
| POST | `/api/tasks/:id/fail` | Falhar tarefa |
| POST | `/api/agents/register` | Registrar agente |
| POST | `/api/agents/heartbeat` | Heartbeat do agente |

---

## 9. Testes

### 9.1 Testes de Integração

```typescript
// backend/src/__tests__/moltbotIntegration.test.ts

describe('Moltbot Integration', () => {
    describe('Gateway Connection', () => {
        it('should connect to gateway', async () => {
            const status = await moltbotGateway.getStatus();
            expect(status).toBeDefined();
        });

        it('should get WhatsApp status', async () => {
            const status = await moltbotGateway.getWhatsAppStatus();
            expect(status.connected).toBeDefined();
        });
    });

    describe('Tulipa Connection', () => {
        it('should connect to Tulipa server', async () => {
            const status = await tulipaService.getSystemStatus();
            expect(status).toBeDefined();
        });

        it('should fetch brain people', async () => {
            const people = await tulipaService.getPeople();
            expect(Array.isArray(people)).toBe(true);
        });
    });

    describe('Message Flow', () => {
        it('should send message via adapter', async () => {
            channelRouter.setWhatsAppProvider('moltbot');
            const result = await messageServiceAdapter.sendText(
                'default',
                '5511999999999@c.us',
                'Test message'
            );
            expect(result).toBeDefined();
        });
    });
});
```

### 9.2 Health Check Script

```bash
#!/bin/bash
# scripts/check-integration.sh

echo "Checking Moltbot Gateway..."
curl -s http://localhost:18789/api/status | jq .

echo "Checking Tulipa Server..."
curl -s http://localhost:8081/api/status/quick | jq .

echo "Checking WhatsApp Status..."
curl -s http://localhost:8081/api/whatsapp/status | jq .
```

---

## 10. Monitoramento

### 10.1 Métricas a Monitorar

| Métrica | Fonte | Threshold |
|---------|-------|-----------|
| Gateway Response Time | Moltbot | < 500ms |
| WhatsApp Connection Status | Moltbot | connected |
| Brain Events/Day | Tulipa | > 0 |
| Task Success Rate | Tulipa | > 95% |
| Sync Errors/Day | sistemav2 | < 10 |

### 10.2 Alertas

Configurar alertas para:
- Gateway offline
- WhatsApp desconectado por > 5 minutos
- Sync falhou 3x consecutivas
- Task stuck por > 1 hora

---

## 11. Rollback Plan

Se a integração falhar:

1. **Feature Flag:** `WHATSAPP_PROVIDER=legacy`
2. O sistema automaticamente volta a usar whatsapp-web.js
3. Brain Hub continua funcionando (read-only)
4. Logs são mantidos para análise

---

## 12. Checklist de Implementação

### Fase 1: Preparação
- [ ] Criar `backend/src/services/moltbotGateway.ts`
- [ ] Criar `backend/src/services/tulipaService.ts`
- [ ] Criar `backend/src/services/channelRouter.ts`
- [ ] Criar `backend/src/config/features.ts`
- [ ] Adicionar variáveis de ambiente ao `.env.example`
- [ ] Documentar endpoints no README

### Fase 2: Integração Read-Only
- [ ] Implementar `moltbotGateway.getStatus()`
- [ ] Implementar `tulipaService.getPeople()`
- [ ] Implementar `tulipaService.getEvents()`
- [ ] Adicionar endpoint `/api/integration/status`
- [ ] Testar conexão com ambos os serviços

### Fase 3: Escrita Dual
- [ ] Criar `MessageServiceAdapter`
- [ ] Implementar envio via Moltbot
- [ ] Implementar feature flag
- [ ] Testar envio de mensagens
- [ ] Testar envio de arquivos
- [ ] Testar envio de áudio

### Fase 4: Sincronização
- [ ] Implementar `SyncService`
- [ ] Cron job de sync diário
- [ ] UI para visualizar Brain Hub
- [ ] Testar fluxo completo

### Fase 5: Deprecação Legacy
- [ ] Migrar para 100% Moltbot
- [ ] Remover dependência whatsapp-web.js
- [ ] Atualizar documentação
- [ ] Cleanup código

---

## 13. Referências

- [Tulipa MOLTBOT_INTEGRATION_PLAN.md](file:///c:/Projetos/tulipa/docs/architecture/MOLTBOT_INTEGRATION_PLAN.md)
- [Tulipa MOLTBOT_BRAIN_VIABILITY.md](file:///c:/Projetos/tulipa/docs/architecture/MOLTBOT_BRAIN_VIABILITY.md)
- [Tulipa MOLTBOT_BRAIN_WEB_RESEARCH.md](file:///c:/Projetos/tulipa/docs/research/MOLTBOT_BRAIN_WEB_RESEARCH.md)
- [OpenClaw Documentation](https://docs.openclaw.ai)
- [sistemav2 WhatsApp Module Analysis](./WHATSAPP_MODULE_ANALYSIS.md)

---

*Documento gerado automaticamente por Claude Code*
*Última atualização: 2026-02-14*
