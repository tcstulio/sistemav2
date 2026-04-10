import { messageService } from './legacy/messageService';
import { aiService } from './aiService';
import { storeService } from './storeService';
import { dolibarrService } from './dolibarrService';
import { sessionService } from './legacy/sessionService';
import { schedulerService } from './schedulerService';
import { approvalService } from './approvalService';
import { interApiService } from './interApiService';
import { itauApiService } from './itauApiService';
import { logger } from '../utils/logger';

const log = logger.child('BotService');

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

class BotService {

    /**
     * Main entry point for processing incoming messages
     */
    async processMessage(message: any) {
        try {
            // 1. Basic Filters
            if (message.fromMe) return; // Ignore own messages (unless we want to track manual replies for assignment?)
            // Manual replies are tracked in the SEND route, not here. Here is implementation for INCOMING.

            // 2. Identify Context
            const chatId = message.from; // e.g. 551199999999@c.us
            const sessionId = message.sessionId;
            let body = message.body;

            // AUDIO TRANSCRIPTION - Transcribe voice messages for LLM processing
            if ((message.type === 'ptt' || message.type === 'audio') && message.hasMedia) {
                log.info('Audio message detected, attempting transcription...');
                try {
                    const media = await messageService.getMessageMedia(sessionId, message.id);
                    if (media && media.data) {
                        const base64Audio = Buffer.isBuffer(media.data)
                            ? media.data.toString('base64')
                            : media.data;
                        const mimeType = media.contentType || 'audio/ogg';
                        const transcription = await aiService.transcribeAudio(base64Audio, mimeType);
                        body = `[Áudio transcrito]: ${transcription}`;
                        log.debug(`Audio transcribed: ${transcription.substring(0, 50)}...`);
                    }
                } catch (e: any) {
                    log.warn(`Audio transcription failed: ${e.message}`);
                    body = '[Áudio recebido - transcrição falhou]';
                }
            }

            if (!body || body.length < 2) return; // Ignore empty/short messages

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
                let rawMapped = rawHistory.map((m: any) => {
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

            // [ANTIGRAVITY] INJECT CRM DATA
            try {
                const phone = chatId.split('@')[0];
                const customer = await dolibarrService.getThirdPartyByPhone(phone);

                if (customer) {
                    log.info(`Found CRM Customer: ${customer.name}`);
                    const crmData = await dolibarrService.getCustomerContext(customer.id);
                    context += `\n\n[DADOS DO CLIENTE IDENTIFICADO NO CRM]\nNome: ${customer.name}\n${crmData}\n\nUse estes dados para responder perguntas sobre faturas, tickets ou status.`;
                } else {
                    context += `\n\n[CRM] Telefone ${phone} não encontrado no banco de dados.`;
                }
            } catch (crmError) {
                log.error("CRM Injection Failed", crmError);
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

            // Generate reply with retry on failure
            let replyText = await retryWithBackoff(
                () => aiService.generateReply(history, context),
                3, // max retries
                1000 // base delay 1s
            );

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
                        const summary = await retryWithBackoff(
                            () => aiService.generateReply([], summaryContext),
                            2, 1000
                        );
                        await messageService.sendText(sessionId, chatId, `📋 *Resumo da Conversa*\n\n${summary}`);
                    } catch (e) {
                        await messageService.sendText(sessionId, chatId, '❌ Erro ao gerar resumo. Tente novamente.');
                    }
                    return true;

                // ===== COMANDOS FINANCEIROS (com aprovação) =====

                case '/pagar': {
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
