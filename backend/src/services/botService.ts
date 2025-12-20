import { messageService } from './messageService';
import { aiService } from './aiService';
import { storeService } from './storeService';
import { dolibarrService } from './dolibarrService'; // If we need to fetch user names dynamically

// Delay helper
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
            const body = message.body;

            if (!body || body.length < 2) return; // Ignore empty/short checks

            console.log(`[Bot] Processing incoming message from ${chatId} (Session: ${sessionId})`);

            // 3. Resolve Effective Auto-Reply Status
            // Priority: Chat Override > Session Default
            const chatSettings = storeService.getChatSettings(chatId);
            const sessionSettings = storeService.getSessionSettings(sessionId);

            let shouldReply = false;

            if (chatSettings.autoReplyEnabled !== undefined) {
                shouldReply = chatSettings.autoReplyEnabled;
                console.log(`[Bot] Chat ${chatId} has override: ${shouldReply}`);
            } else {
                shouldReply = sessionSettings.autoReply;
            }

            if (!shouldReply) {
                // Check if it's a group with specific settings
                // [ANTIGRAVITY] Group Logic
                if (chatId.endsWith('@g.us')) {
                    const groupSettings = chatSettings.groupSettings;

                    if (groupSettings?.llmEnabled) {
                        console.log(`[Bot] Group ${chatId} has LLM explicitly enabled.`);

                        // 1. Frequency Check
                        if (groupSettings.responseFrequency && groupSettings.lastRepliedAt) {
                            const now = Date.now();
                            const elapsed = now - groupSettings.lastRepliedAt;
                            let required = groupSettings.responseFrequency.value * 3600000; // Hours default
                            if (groupSettings.responseFrequency.unit === 'days') required = required * 24;
                            if (groupSettings.responseFrequency.unit === 'minutes') required = groupSettings.responseFrequency.value * 60000;

                            if (elapsed < required) {
                                console.log(`[Bot] Group ${chatId} skipping: Frequency limit not met. (Elapsed: ${elapsed / 1000}s, Required: ${required / 1000}s)`);
                                return;
                            }
                        }

                        // 2. Burst / Spam Check
                        if (groupSettings.burstHandling?.enabled) {
                            const threshold = groupSettings.burstHandling.threshold || 5;
                            const currentCount = (groupSettings.messageCounter || 0) + 1;

                            console.log(`[Bot] Group ${chatId} Burst Counter: ${currentCount}/${threshold}`);

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

            console.log(`[Bot] Generating Auto-Reply for ${chatId}...`);

            // 5. Generate AI Reply
            // Need conversation history? MessageService has getMessages.
            // For now, let's fetch last 10 messages for context
            let history: any[] = [];
            try {
                const rawHistory = await messageService.getMessages(sessionId, chatId, 10);

                // 1. Initial Map & Clean History
                let rawMapped = rawHistory.map((m: any) => {
                    // Strip existing signatures from history to avoid poisoning the LLM context
                    // Remove lines starting with ~ at the end
                    const cleanBody = (m.body || '').replace(/(\n\s*~.*)+$/g, '').trim();
                    return {
                        role: m.fromMe ? 'model' : 'user',
                        parts: cleanBody
                    };
                }).filter((m: any) => m.parts && m.parts.length > 0 && !m.parts.startsWith('Erro LLM Local'));

                // 2. Consolidate Consecutive Roles
                const consolidated: any[] = [];
                for (const msg of rawMapped) {
                    if (consolidated.length > 0 && consolidated[consolidated.length - 1].role === msg.role) {
                        consolidated[consolidated.length - 1].parts += `\n${msg.parts}`;
                    } else {
                        consolidated.push(msg);
                    }
                }

                history = consolidated;
            } catch (e) {
                console.warn(`[Bot] Failed to fetch history for ${chatId}, using explicit prompt only.`);
            }

            // 6. Resolve Signature & Context (Session/Account Level)
            let context = sessionSettings.autoReplyContext || "Você é um assistente virtual útil.";

            // [ANTIGRAVITY] INJECT CRM DATA
            try {
                const phone = chatId.split('@')[0];
                const customer = await dolibarrService.getThirdPartyByPhone(phone);

                if (customer) {
                    console.log(`[Bot] Found CRM Customer: ${customer.name}`);
                    const crmData = await dolibarrService.getCustomerContext(customer.id);
                    context += `\n\n[DADOS DO CLIENTE IDENTIFICADO NO CRM]\nNome: ${customer.name}\n${crmData}\n\nUse estes dados para responder perguntas sobre faturas, tickets ou status.`;
                } else {
                    context += `\n\n[CRM] Telefone ${phone} não encontrado no banco de dados.`;
                }
            } catch (crmError) {
                console.error("[Bot] CRM Injection Failed:", crmError);
            }

            let signatureName = "Assistente Virtual";
            if (sessionSettings.signatureName && sessionSettings.signatureName.trim().length > 0) {
                signatureName = sessionSettings.signatureName;
            }

            // Generate
            let replyText = await aiService.generateReply(history, context);

            // Cleanup: Strip any hallucinated signatures in the response
            if (replyText) {
                replyText = replyText.replace(/(\n\s*~.*)+$/g, '').trim();
            }

            // 7. Append Signature
            const finalMessage = `${replyText}\n\n~ ${signatureName}`;

            await sleep(2000); // 2s simulated typing

            await messageService.sendText(sessionId, chatId, finalMessage);
            console.log(`[Bot] Auto-reply sent to ${chatId}`);

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
            console.error('[Bot] Process Error:', error.message);
        }
    }
}

export const botService = new BotService();
