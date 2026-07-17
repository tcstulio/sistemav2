import { messageService } from './legacy/messageService';
import { aiService } from './aiService';
import { runWithToolContext, getToolsPrompt, DEV_TOOLS } from './agentTools';
import { storeService } from './storeService';
import { dolibarrService } from './dolibarrService';
import { sessionService } from './legacy/sessionService';
import { schedulerService } from './schedulerService';
import { approvalService } from './approvalService';
import { interApiService } from './interApiService';
import { itauApiService } from './itauApiService';
import { logger } from '../utils/logger';
import { FEATURES } from '../config/features';
import { isFinancialCommandsEnabled, isCrmContextInjectionEnabled, isWhatsappEmployeeElevationEnabled } from '../config/featureSwitches';
import { whatsappIdentityService, SenderIdentity } from './whatsappIdentityService';
import { userPermissionsService } from './userPermissionsService';

const log = logger.child('BotService');

// #1501 — por design, o canal WhatsApp NUNCA é admin. O bot atende Comercial/Financeiro/Produtor:
// mesmo que o remetente tenha cargo admin no ERP, no canal WhatsApp ele é tratado como usuário
// de negócio. aiService internamente já chama getToolsPrompt({ isAdmin: getToolContext().isAdmin
// === true }) respeitando o runWithToolContext — mas tornamos isso EXPLÍCITO aqui também:
//   (a) documenta a invariante "WhatsApp nunca é admin" no próprio fluxo do bot;
//   (b) falhamos ALTO na primeira chamada se o filtro não-admin do #1498 algum dia regredir e
//       voltar a vazar DEV_TOOLS neste canal. Defesa em profundidade: executeTool também barra
//       DEV_TOOLS via ctx.isAdmin !== true, mas o ideal é não depender só dessa 2ª linha.
// Inicialização LAZY (não no module-load): botService entra num ciclo de imports
// (channelRouter→messageService→sessionService→botService), e chamar getToolsPrompt aqui
// dispararia um TDZ em agentTools.TOOLS_PROMPT_FULL antes da const ser avaliada. Adiar a
// construção até a 1ª chamada resolve o ciclo sem alterar a invariante "WhatsApp nunca é admin".
let _whatsappBotToolsPrompt: string | undefined;
export function getWhatsAppBotToolsPrompt(): string {
    if (_whatsappBotToolsPrompt !== undefined) return _whatsappBotToolsPrompt;
    const prompt = getToolsPrompt({ isAdmin: false });
    for (const devTool of DEV_TOOLS) {
        if (prompt.includes(devTool)) {
            log.error('#1501: getToolsPrompt({isAdmin:false}) vazou DEV_TOOL — filtro #1498 regrediu', { devTool });
            throw new Error(`#1501: WHATSAPP_BOT_TOOLS_PROMPT contém DEV_TOOL "${devTool}" — filtro não-admin #1498 regrediu`);
        }
    }
    _whatsappBotToolsPrompt = prompt;
    return _whatsappBotToolsPrompt;
}

// #1501 — fail-fast self-check de produção (defesa em profundidade contra regressão de
// #1498). Chamada no início de processMessage, ANTES de qualquer trabalho caro
// (identifySender, dolibarrService.getCustomerContext, aiService.generateReply). Custo
// ≈ 0 depois da 1ª chamada (cache em `_whatsappBotToolsPrompt` + flag local). Se o
// filtro não-admin algum dia regredir e vazar uma DEV_TOOL, jogamos throw ALTO no log
// já na 1ª mensagem — sem isso, a invariante "WhatsApp nunca é admin" só estaria
// coberta pelos testes. `executeTool` também barra DEV_TOOLS via ctx.isAdmin !== true,
// mas o ideal é não depender SÓ dessa 2ª linha. EXPORTADA para que o teste possa
// reinjetar o ciclo lazy no setup (vi.resetModules + re-import).
let _whatsappBotToolsPromptValidated = false;
export function validateWhatsAppBotToolsPrompt(): void {
    if (_whatsappBotToolsPromptValidated) return;
    getWhatsAppBotToolsPrompt(); // throws se uma DEV_TOOL escapar (regressão #1498)
    _whatsappBotToolsPromptValidated = true;
}

// Delay helper
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Retry helper with exponential backoff
async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelayMs: number = 1000
): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (e: any) {
            lastError = e;
            if (attempt < maxRetries - 1) {
                const delay = baseDelayMs * Math.pow(2, attempt);
                log.warn(`Retry attempt ${attempt + 1}/${maxRetries} failed. Retrying in ${delay}ms...`);
                await sleep(delay);
            }
        }
    }
    throw lastError || new Error('Max retries exceeded');
}

/** Id ESTÁVEL de uma mensagem do WhatsApp (string), tolerante ao formato do whatsapp-web.js. */
function messageId(message: any): string {
    const id = message?.id;
    if (!id) return '';
    if (typeof id === 'string') return id;
    return String(id._serialized || id.id || '');
}

// Dedup de mensagem (red-team 2026-07-17): o whatsapp-web.js RE-EMITE `message_create` em
// reconexão/replay (o próprio churn de @lid da memória). Sem dedup, o pipeline inteiro roda 2× →
// escrita duplicada, LLM em dobro e resposta repetida. Guarda o msg.id por uma janela curta (a
// re-emissão é logo após reconectar). Complementa a idempotência de ESCRITA (writeIdempotency): esta
// corta ANTES de gastar LLM/responder; aquela é o backstop durável só do efeito de escrita.
const MSG_DEDUP_TTL_MS = 5 * 60 * 1000; // 5 min
const seenMessages = new Map<string, number>();
function alreadyProcessed(id: string): boolean {
    if (!id) return false; // sem id não dá p/ deduplicar — segue (não pior que hoje)
    const now = Date.now();
    for (const [k, exp] of seenMessages) if (exp <= now) seenMessages.delete(k); // limpeza preguiçosa
    if (seenMessages.has(id)) return true;
    seenMessages.set(id, now + MSG_DEDUP_TTL_MS);
    return false;
}

/** SÓ TESTES: zera o dedup de mensagens (o Map é de processo; testes reusam ids). */
export function __resetMessageDedupForTests(): void { seenMessages.clear(); }

class BotService {

    /**
     * Main entry point for processing incoming messages
     */
    async processMessage(message: any) {
        try {
            // 1. Basic Filters
            if (message.fromMe) return; // Ignore own messages (unless we want to track manual replies for assignment?)
            // Manual replies are tracked in the SEND route, not here. Here is implementation for INCOMING.

            // Dedup de re-emissão: mesma mensagem entregue 2× (reconexão/replay do whatsapp-web.js) NÃO
            // reprocessa. Marca ANTES de qualquer await (atômico no event loop) p/ também cobrir corrida
            // de eventos quase-simultâneos. Uma nova pergunta do usuário tem outro id → não é bloqueada.
            const msgId = messageId(message);
            if (alreadyProcessed(msgId)) {
                log.debug(`Mensagem ${msgId.slice(0, 16)}… já processada — ignorando re-emissão.`);
                return;
            }

            // 2. Identify Context
            const chatId = message.from; // e.g. 551199999999@c.us
            const sessionId = message.sessionId;
            let body = message.body;

            // AUDIO TRANSCRIPTION - Transcribe voice messages for LLM processing.
            // #1127: respeita a flag AUDIO_TRANSCRIPTION_ENABLED (antes transcrevia SEMPRE, sem como
            // cortar o custo de ASR). Default true; setar AUDIO_TRANSCRIPTION_ENABLED=false desliga.
            if (FEATURES.AUDIO_TRANSCRIPTION_ENABLED && (message.type === 'ptt' || message.type === 'audio') && message.hasMedia) {
                log.info('Audio message detected, attempting transcription...');
                try {
                    const media = await messageService.getMessageMedia(sessionId, message.id);
                    if (media && media.data) {
                        const base64Audio = Buffer.isBuffer(media.data)
                            ? media.data.toString('base64')
                            : media.data;
                        const mimeType = media.contentType || 'audio/ogg';
                        const transcription = await aiService.transcribeAudio(base64Audio, mimeType, 'chat');
                        body = `[Áudio transcrito]: ${transcription}`;
                        log.debug(`Audio transcribed: ${transcription.substring(0, 50)}...`);
                    }
                } catch (e: any) {
                    log.warn(`Audio transcription failed: ${e.message}`);
                    body = '[Áudio recebido - transcrição falhou]';
                }
            }

            if (!body || body.length < 2) return; // Ignore empty/short messages

            // #1501 — canal WhatsApp NUNCA é admin (ver comentário em getWhatsAppBotToolsPrompt
            // acima). Fail-fast: se o filtro não-admin de #1498 regrediu, o throw aqui aborta a
            // mensagem ANTES de chamar aiService.generateReply — sem LLM tokens gastos.
            validateWhatsAppBotToolsPrompt();

            log.info(`Processing incoming message from ${chatId} (Session: ${sessionId})`);

            // SPECIAL COMMANDS - Process before auto-reply check
            if (body.startsWith('/')) {
                const handled = await this.handleCommand(body, sessionId, chatId);
                if (handled) return; // Command was handled, don't continue to LLM
            }

            // CONFIRMATION DETECTION - Check for pending confirmations (SIM/NÃO)
            const confirmation = schedulerService.checkConfirmation(chatId);
            if (confirmation) {
                const normalizedBody = body.toLowerCase().trim();
                const isConfirm = ['sim', 'yes', 's', 'confirmo', 'ok', '1'].includes(normalizedBody);
                const isReject = ['não', 'nao', 'no', 'n', 'cancelo', 'cancelar', '2'].includes(normalizedBody);

                if (isConfirm || isReject) {
                    const callback = schedulerService.handleConfirmationResponse(chatId, isConfirm);
                    const response = isConfirm
                        ? '✅ Confirmação recebida! Obrigado.'
                        : '❌ Cancelamento registrado.';
                    await messageService.sendText(sessionId, chatId, response);
                    log.info(`Confirmation ${isConfirm ? 'accepted' : 'rejected'} for ${chatId}`);
                    return; // Don't process further
                }
            }

            // CHATBOT FLOW - Check for active flow or trigger new one
            const activeFlow = schedulerService.getActiveFlow(chatId);
            if (activeFlow) {
                // Process response in active flow
                const result = schedulerService.processFlowResponse(chatId, body);

                if (result.response) {
                    await messageService.sendText(sessionId, chatId, result.response);
                }

                if (result.nextStep && !result.endFlow) {
                    await messageService.sendText(sessionId, chatId, result.nextStep.message);
                }

                log.debug(`Flow processed for ${chatId}, ended: ${result.endFlow}`);
                return; // Don't continue to LLM
            } else {
                // Check if message triggers a new flow
                const triggeredFlow = schedulerService.checkFlowTrigger(sessionId, body);
                if (triggeredFlow) {
                    const firstStep = schedulerService.startFlow(chatId, triggeredFlow);
                    if (firstStep) {
                        await messageService.sendText(sessionId, chatId, firstStep.message);
                        log.info(`Started flow "${triggeredFlow.name}" for ${chatId}`);
                        return; // Don't continue to LLM
                    }
                }
            }

            // 3. Resolve Effective Auto-Reply Status
            // Priority: Chat Override > Session Default
            const chatSettings = storeService.getChatSettings(chatId);
            const sessionSettings = storeService.getSessionSettings(sessionId);

            let shouldReply = false;

            if (chatSettings.autoReplyEnabled !== undefined) {
                shouldReply = chatSettings.autoReplyEnabled;
                log.debug(`Chat ${chatId} has override: ${shouldReply}`);
            } else {
                shouldReply = sessionSettings.autoReply;
            }

            if (!shouldReply) {
                // Check if it's a group with specific settings
                // [ANTIGRAVITY] Group Logic
                if (chatId.endsWith('@g.us')) {
                    const groupSettings = chatSettings.groupSettings;

                    if (groupSettings?.llmEnabled) {
                        log.debug(`Group ${chatId} has LLM explicitly enabled.`);

                        // 1. Frequency Check
                        if (groupSettings.responseFrequency && groupSettings.lastRepliedAt) {
                            const now = Date.now();
                            const elapsed = now - groupSettings.lastRepliedAt;
                            let required = groupSettings.responseFrequency.value * 3600000; // Hours default
                            if (groupSettings.responseFrequency.unit === 'days') required = required * 24;
                            if (groupSettings.responseFrequency.unit === 'minutes') required = groupSettings.responseFrequency.value * 60000;

                            if (elapsed < required) {
                                log.debug(`Group ${chatId} skipping: Frequency limit not met. (Elapsed: ${elapsed / 1000}s, Required: ${required / 1000}s)`);
                                return;
                            }
                        }

                        // 2. Burst / Spam Check
                        if (groupSettings.burstHandling?.enabled) {
                            const threshold = groupSettings.burstHandling.threshold || 5;
                            const currentCount = (groupSettings.messageCounter || 0) + 1;

                            log.debug(`Group ${chatId} Burst Counter: ${currentCount}/${threshold}`);

                            // Update Counter
                            storeService.updateChatSettings(chatId, {
                                groupSettings: {
                                    ...groupSettings,
                                    messageCounter: currentCount
                                }
                            });

                            if (currentCount < threshold) {
                                return; // Wait for more messages
                            }

                            // Threshold Met! Reset counter will happen if we proceed
                        }

                        // Passed checks -> Proceed to Reply
                        shouldReply = true;
                    }
                }
            }

            if (!shouldReply) {
                return;
            }

            log.info(`Generating Auto-Reply for ${chatId}...`);

            // Detect if this is a group chat
            const isGroup = chatId.endsWith('@g.us');

            // 5. Generate AI Reply with configurable history limit
            const historyLimit = sessionSettings.historyLimit || 30;
            let history: any[] = [];
            try {
                const rawHistory = await messageService.getMessages(sessionId, chatId, historyLimit);

                // 1. Initial Map & Clean History (with senderName for groups + media context)
                let rawMapped = rawHistory
                    .filter((m: any) => {
                        const b = m.body || '';
                        return !b.includes('Status do Sistema') && 
                               !b.includes('Comandos Disponíveis') && 
                               !b.startsWith('/');
                    })
                    .map((m: any) => {
                    // Strip existing signatures from history to avoid poisoning the LLM context
                    const cleanBody = (m.body || '').replace(/(\n\s*~.*)+$/g, '').trim();

                    // Add media context when message has media but no text
                    const mediaNote = (m.hasMedia && !cleanBody)
                        ? `[Mídia recebida: ${m.type || 'arquivo'}]`
                        : '';

                    // For groups, prepend the sender name to provide context to the LLM
                    const senderPrefix = (!m.fromMe && isGroup && m.senderName)
                        ? `[${m.senderName}]: `
                        : '';

                    return {
                        role: m.fromMe ? 'model' : 'user',
                        parts: senderPrefix + (cleanBody || mediaNote),
                        senderName: m.senderName || null
                    };
                }).filter((m: any) => m.parts && m.parts.length > 0 && !m.parts.startsWith('Erro LLM Local'));

                // 2. Smart Consolidation - Don't merge messages from different people in groups
                const consolidated: any[] = [];
                for (const msg of rawMapped) {
                    const lastMsg = consolidated[consolidated.length - 1];
                    const sameRole = lastMsg?.role === msg.role;
                    const sameSender = lastMsg?.senderName === msg.senderName;

                    // Only consolidate if same role AND (same sender OR not a group context)
                    if (consolidated.length > 0 && sameRole && (sameSender || !isGroup)) {
                        lastMsg.parts += `\n${msg.parts}`;
                    } else {
                        consolidated.push({ role: msg.role, parts: msg.parts, senderName: msg.senderName });
                    }
                }

                // Remove senderName before sending to AI (it's embedded in parts now)
                history = consolidated.map(m => ({ role: m.role, parts: m.parts }));
            } catch (e) {
                log.warn(`Failed to fetch history for ${chatId}, using explicit prompt only.`);
            }

            // 6. Resolve Signature & Context (Session/Account Level)
            let context = sessionSettings.autoReplyContext || "Você é um assistente virtual útil.";

            // [ANTIGRAVITY] INJECT SYSTEM DATE/TIME
            const now = new Date();
            const dateStr = now.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            context += `\n\n[SISTEMA] Data atual: ${dateStr}. Hora: ${timeStr}. Use esta referência para termos relativos (hoje, ontem, amanhã).`;

            // Add group-specific context for better LLM behavior
            if (isGroup) {
                context += "\n\n[CONTEXTO DE GRUPO] Esta é uma conversa de grupo do WhatsApp. Múltiplos usuários participam. Os nomes dos remetentes estão indicados entre colchetes [Nome]. Responda de forma que seja útil para todos no grupo.";
            }

            // Identidade do remetente (funcionário × cliente × desconhecido) — decide o contexto
            // de permissões e o que injetar no LLM. Grupo NUNCA identifica: o autor é ambíguo e
            // manipulável pelos demais participantes (fail-closed = unknown).
            let senderIdentity: SenderIdentity = { kind: 'unknown' };
            if (!isGroup) {
                try {
                    senderIdentity = await whatsappIdentityService.identifySender(message.realSender || chatId);
                } catch (e: any) {
                    log.warn(`Identificação do remetente falhou (${e?.message}) — seguindo como desconhecido.`);
                }
            }

            // [ANTIGRAVITY] INJECT CRM DATA
            // #1129: kill-switch de privacidade (env + toggle de UI) — desligado em incidente
            // NÃO injeta dados do cliente no LLM. Mesmo padrão do kill-switch financeiro.
            if (isCrmContextInjectionEnabled() && senderIdentity.kind === 'customer') {
                try {
                    log.info(`Found CRM Customer: ${senderIdentity.name}`);
                    const crmData = await dolibarrService.getCustomerContext(senderIdentity.thirdpartyId);
                    context += `\n\n[DADOS DO CLIENTE IDENTIFICADO NO CRM]\nNome: ${senderIdentity.name}\n${crmData}\n\nUse estes dados para responder perguntas sobre faturas, tickets ou status.`;
                } catch (crmError) {
                    log.error("CRM Injection Failed", crmError);
                }
            } else if (isCrmContextInjectionEnabled() && senderIdentity.kind === 'unknown' && !isGroup) {
                context += `\n\n[CRM] Remetente não identificado no banco de dados.`;
            }

            let signatureName = "Assistente Virtual";
            if (sessionSettings.signatureName && sessionSettings.signatureName.trim().length > 0) {
                signatureName = sessionSettings.signatureName;
            }

            // Send typing indicator before generating reply
            try {
                await sessionService.sendTyping(sessionId, chatId);
            } catch (e) {
                log.warn('Failed to send typing indicator');
            }

            // Generate reply with retry on failure.
            // Mensagem de WhatsApp de entrada é input NÃO-CONFIÁVEL: o default é somente-leitura
            // (nenhuma tool de escrita/efeito externo). Exceção controlada: FUNCIONÁRIO identificado
            // pelo telefone, em chat 1:1, com o kill-switch whatsappEmployeeElevation ligado — recebe
            // o próprio perfil de permissões, como no chat do webapp. isAdmin fica SEMPRE false por
            // aqui: ação irreversível continua exigindo o deeplink /confirm-action logado no webapp
            // (o login é o 2º fator; adminBypassIrreversible nunca se aplica via WhatsApp).
            // turnId ESTÁVEL do turno = id da mensagem do WhatsApp. Torna toda escrita idempotente por
            // (turno, ator, tool, args): a mesma escrita não roda 2× se o retryWithBackoff re-invocar
            // generateReply após um throw pós-escrita, nem numa re-emissão do evento. Ver writeIdempotency.
            // #1501 — `isAdmin: false` explícito em TODOS os caminhos (default e elevação de funcionário):
            // o canal WhatsApp nunca é admin, ponto.
            const turnId = messageId(message);
            let toolCtx: Parameters<typeof runWithToolContext>[0] = { readOnly: true, isAdmin: false, turnId };
            // #segurança — só ELEVA (perfil + escrita) com match do número COMPLETO (E.164). O
            // matchStrength só existe como 'full' (matchEmployee já exige número inteiro), mas a
            // checagem explícita é defesa em profundidade: um match fraco jamais concede perfil.
            // #1501 — `isAdmin: false` permanece EXPLÍCITO mesmo no caminho de elevação de
            // funcionário: o canal WhatsApp nunca é admin, mesmo que o usuário seja admin no ERP.
            if (senderIdentity.kind === 'employee' && senderIdentity.matchStrength === 'full' && !isGroup && isWhatsappEmployeeElevationEnabled()) {
                try {
                    const permissionProfile = await userPermissionsService.getProfile(senderIdentity.userId);
                    const permContext = await userPermissionsService.getProfileForContext(senderIdentity.userId);
                    toolCtx = { readOnly: false, userId: senderIdentity.userId, isAdmin: false, permissionProfile, turnId };
                    context += `\n\n[FUNCIONÁRIO IDENTIFICADO]\nVocê está falando com ${senderIdentity.displayName} (usuário interno, id ${senderIdentity.userId}), identificado pelo telefone.\n\n${permContext}`;
                    log.info(`Funcionário identificado no WhatsApp: ${senderIdentity.displayName} (id ${senderIdentity.userId}) — contexto com o perfil do usuário.`);
                } catch (e: any) {
                    log.warn(`Elevação de funcionário falhou (${e?.message}) — mantendo somente-leitura.`);
                }
            }
            let replyResult = await retryWithBackoff(
                () => runWithToolContext(toolCtx, () => aiService.generateReply(history, context)),
                3,
                1000
            );
            let replyText = typeof replyResult === 'string' ? replyResult : replyResult.text;

            // Converter links internos relativos para absolutos APENAS para o WhatsApp
            // A interface web continuará usando caminhos relativos (para manter o SPA layout)
            if (replyText) {
                const baseUrl = process.env.FRONTEND_URL || 'https://app.coolgroove.com.br';
                replyText = replyText.replace(/(?<=^|\s)(\/[a-zA-Z0-9_\-\/\?=\.\&\%]+)/g, match => baseUrl + match);
            }

            // Cleanup: Strip any hallucinated signatures in the response
            if (replyText) {
                replyText = replyText.replace(/(\n\s*~.*)+$/g, '').trim();
            }

            // 7. Append Signature
            const finalMessage = `${replyText}\n\n~ ${signatureName}`;

            await sleep(1500); // Reduced to 1.5s since real typing is now shown

            await messageService.sendText(sessionId, chatId, finalMessage);
            log.info(`Auto-reply sent to ${chatId}`);

            // [ANTIGRAVITY] Update Group Stats (Last Replied / Reset Burst)
            if (chatId.endsWith('@g.us')) {
                const currentFn = storeService.getChatSettings(chatId).groupSettings || {};
                storeService.updateChatSettings(chatId, {
                    groupSettings: {
                        ...currentFn,
                        lastRepliedAt: Date.now(),
                        messageCounter: 0 // Reset burst counter
                    }
                });
            }

        } catch (error: any) {
            log.error(`Process Error: ${error.message}`);
        }
    }

    /**
     * Handle special slash commands
     * Returns true if command was handled, false otherwise
     */
    private async handleCommand(body: string, sessionId: string, chatId: string): Promise<boolean> {
        const cmd = body.split(' ')[0].toLowerCase().trim();

        try {
            switch (cmd) {
                case '/status':
                    const sessionStatus = storeService.getSessionSettings(sessionId);
                    const statusMsg = `📊 *Status do Sistema*\n\n` +
                        `✅ Bot: Ativo\n` +
                        `🤖 Auto-resposta: ${sessionStatus.autoReply ? 'Ligada' : 'Desligada'}\n` +
                        `📝 Histórico LLM: ${sessionStatus.historyLimit || 10} mensagens\n` +
                        `⏰ Hora: ${new Date().toLocaleString('pt-BR')}`;
                    await messageService.sendText(sessionId, chatId, statusMsg);
                    return true;

                case '/ajuda':
                case '/help':
                    const helpMsg = `📖 *Comandos Disponíveis*\n\n` +
                        `*Gerais:*\n` +
                        `/status - Mostra status do sistema\n` +
                        `/resumo - Resume a conversa atual\n` +
                        `/ajuda - Lista comandos disponíveis\n\n` +
                        `*Financeiro (requer aprovação):*\n` +
                        `/pagar <código_barras> - Pagar boleto\n` +
                        `/pix <chave> <valor> - Enviar PIX\n` +
                        `/saldo [inter|itau] - Consultar saldo`;
                    await messageService.sendText(sessionId, chatId, helpMsg);
                    return true;

                case '/resumo':
                    // Fetch history and summarize
                    const history = await messageService.getMessages(sessionId, chatId, 20);
                    if (history.length === 0) {
                        await messageService.sendText(sessionId, chatId, '❌ Nenhuma mensagem encontrada para resumir.');
                        return true;
                    }

                    const historyText = history.map((m: any) =>
                        `${m.fromMe ? 'BOT' : (m.senderName || 'USUÁRIO')}: ${m.body || '[mídia]'}`
                    ).join('\n');

                    const summaryContext = `Resuma a seguinte conversa em bullet points concisos em português:\n\n${historyText}`;

                    try {
                        await sessionService.sendTyping(sessionId, chatId);
                        // #segurança (red-team 2026-07-17): /resumo roda o MESMO loop de tools do
                        // generateReply com histórico controlável pelo remetente. Sem contexto de tool,
                        // executeTool herdava o DEFAULT (readOnly falsy) → um tool JSON emitido aqui
                        // escreveria SEM gate. Fecha embrulhando em readOnly (resumo é leitura pura).
                        const summaryResult = await retryWithBackoff(
                            () => runWithToolContext({ readOnly: true }, () => aiService.generateReply([], summaryContext)),
                            2, 1000
                        );
                        const summary = typeof summaryResult === 'string' ? summaryResult : summaryResult.text;
                        await messageService.sendText(sessionId, chatId, `📋 *Resumo da Conversa*\n\n${summary}`);
                    } catch (e) {
                        await messageService.sendText(sessionId, chatId, '❌ Erro ao gerar resumo. Tente novamente.');
                    }
                    return true;

                // ===== COMANDOS FINANCEIROS (com aprovação) =====

                case '/pagar': {
                    // #1129: kill-switch de admin (env + toggle de UI) — desligado em incidente bloqueia /pagar.
                    if (!isFinancialCommandsEnabled()) {
                        await messageService.sendText(sessionId, chatId,
                            '🔒 *Comandos financeiros desativados*\n\nO pagamento via bot está temporariamente indisponível. Contate um administrador.');
                        return true;
                    }
                    const args = body.split(' ').slice(1);
                    const codigoBarras = args.join('').replace(/\D/g, ''); // Remove non-digits

                    if (!codigoBarras || codigoBarras.length < 44) {
                        await messageService.sendText(sessionId, chatId,
                            '❌ *Formato inválido*\n\nUso: `/pagar <código_de_barras>`\n\nExemplo: `/pagar 23793.38128 60000.000000 00000.000006 1 84340000012345`');
                        return true;
                    }

                    // Detectar banco padrão (pode ser configurável)
                    const banco: 'inter' | 'itau' = 'inter';

                    // Criar ação pendente de aprovação
                    const action = await approvalService.createPendingAction({
                        type: 'pagar_boleto',
                        banco,
                        payload: {
                            codigoDeBarras: codigoBarras,
                            dataPagamento: new Date().toISOString().split('T')[0],
                        },
                        description: `Pagar boleto: ${codigoBarras.substring(0, 20)}...`,
                        requestedBy: chatId,
                    });

                    // Armazenar info de notificação
                    (action as any).notifyOnComplete = { sessionId, chatId };

                    await messageService.sendText(sessionId, chatId,
                        `⏳ *Pagamento enviado para aprovação*\n\n` +
                        `📋 ID: ${action.id.substring(0, 8)}\n` +
                        `🏦 Banco: ${banco.toUpperCase()}\n` +
                        `📊 Status: Aguardando aprovação\n\n` +
                        `Você será notificado quando o pagamento for aprovado ou rejeitado.`);
                    return true;
                }

                case '/pix': {
                    // #1129: kill-switch de admin (env + toggle de UI) — desligado em incidente bloqueia /pix.
                    if (!isFinancialCommandsEnabled()) {
                        await messageService.sendText(sessionId, chatId,
                            '🔒 *Comandos financeiros desativados*\n\nO envio de PIX via bot está temporariamente indisponível. Contate um administrador.');
                        return true;
                    }
                    const args = body.split(' ').slice(1);

                    if (args.length < 2) {
                        await messageService.sendText(sessionId, chatId,
                            '❌ *Formato inválido*\n\nUso: `/pix <chave> <valor>`\n\nExemplas:\n`/pix 11999999999 100.00`\n`/pix email@exemplo.com 50`\n`/pix 12345678901234 250.99`');
                        return true;
                    }

                    const chave = args[0];
                    const valorStr = args[1].replace(',', '.');
                    const valor = parseFloat(valorStr);

                    if (isNaN(valor) || valor <= 0) {
                        await messageService.sendText(sessionId, chatId, '❌ Valor inválido. Use formato: 100.00');
                        return true;
                    }

                    const banco: 'inter' | 'itau' = 'inter';

                    const action = await approvalService.createPendingAction({
                        type: 'enviar_pix',
                        banco,
                        payload: {
                            chave,
                            valor: valor.toFixed(2),
                            descricao: `PIX via WhatsApp`,
                        },
                        description: `PIX R$ ${valor.toFixed(2)} para ${chave}`,
                        requestedBy: chatId,
                    });

                    (action as any).notifyOnComplete = { sessionId, chatId };

                    await messageService.sendText(sessionId, chatId,
                        `⏳ *PIX enviado para aprovação*\n\n` +
                        `📋 ID: ${action.id.substring(0, 8)}\n` +
                        `🔑 Chave: ${chave}\n` +
                        `💰 Valor: R$ ${valor.toFixed(2)}\n` +
                        `🏦 Banco: ${banco.toUpperCase()}\n\n` +
                        `Você será notificado quando o PIX for aprovado ou rejeitado.`);
                    return true;
                }

                case '/saldo': {
                    const args = body.split(' ').slice(1);
                    const bancoArg = args[0]?.toLowerCase();

                    let banco: 'inter' | 'itau' = 'inter'; // Default
                    if (bancoArg === 'itau' || bancoArg === 'itaú') {
                        banco = 'itau';
                    }

                    await messageService.sendText(sessionId, chatId, `⏳ Consultando saldo no ${banco.toUpperCase()}...`);

                    try {
                        let saldo: any;
                        if (banco === 'inter') {
                            saldo = await interApiService.getSaldo();
                        } else {
                            saldo = await itauApiService.getSaldo();
                        }

                        const saldoFormatado = typeof saldo === 'object'
                            ? `R$ ${(saldo.disponivel || saldo.saldo || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                            : `R$ ${saldo}`;

                        await messageService.sendText(sessionId, chatId,
                            `💰 *Saldo ${banco.toUpperCase()}*\n\n` +
                            `📊 Disponível: ${saldoFormatado}\n` +
                            `⏰ Consultado em: ${new Date().toLocaleString('pt-BR')}`);
                    } catch (e: any) {
                        await messageService.sendText(sessionId, chatId,
                            `❌ *Erro ao consultar saldo*\n\n${e.message || 'Serviço indisponível'}`);
                    }
                    return true;
                }

                default:
                    // Unknown command - don't handle, let it pass to LLM
                    return false;
            }
        } catch (error: any) {
            log.error(`Command error (${cmd}): ${error.message}`);
            return false;
        }
    }
}

export const botService = new BotService();
