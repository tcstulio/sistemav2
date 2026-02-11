import { config } from '../config';
import { WhatsAppService } from './whatsappService';
import { logger } from '../utils/logger';
// import { EmailService } from './emailService'; // Assuming exists or will exist

const log = logger.child('Automation');

export interface AutomationRule {
    id: string;
    name: string;
    event: string;
    enabled: boolean;
    message?: string;
    templateId?: string;
    sessionId: string;
    channel?: 'whatsapp' | 'email';
    subject?: string;
    delay?: number;
}

const API_BASE = config.API_BASE_URL;

export const AutomationService = {
    getRules: async (): Promise<AutomationRule[]> => {
        try {
            const res = await fetch(`${API_BASE}/api/webhook/rules`);
            if (!res.ok) return [];
            const data = await res.json();
            return data.data || [];
        } catch (e) {
            log.error("Failed to fetch automation rules", e);
            return [];
        }
    },

    trigger: async (event: string, context: Record<string, any>) => {
        const rules = await AutomationService.getRules();
        const activeRules = rules.filter(r => r.enabled && r.event === event);

        for (const rule of activeRules) {
            try {
                // 1. Process Message Template
                let messageText = rule.message || '';

                // Replace variables
                Object.keys(context).forEach(key => {
                    const regex = new RegExp(`{{${key}}}`, 'g');
                    messageText = messageText.replace(regex, String(context[key] || ''));
                });

                // 2. Identify Target
                let target = '';
                if (rule.channel === 'email') {
                    // Expect context to have user_email or customer_email
                    target = context.user_email || context.customer_email || '';
                } else {
                    // WhatsApp
                    // Expect context to have user_phone or customer_phone or user_mobile
                    // Clean number
                    target = (context.user_phone || context.user_mobile || context.customer_phone || '').replace(/\D/g, '');

                    // Basic validation/formatting
                    if (target.length > 0 && target.length <= 11) {
                        target = '55' + target;
                    }
                    if (target) target += '@c.us';
                }

                if (!target) {
                    log.warn(`No target found for rule ${rule.name}`);
                    continue;
                }

                // 3. Send
                if (rule.channel === 'email') {
                    // await EmailService.send(rule.sessionId, target, rule.subject || 'Notificação', messageText);
                    log.debug("Email automation not yet fully linked");
                } else {
                    await WhatsAppService.sendMessage(target, messageText, rule.sessionId || 'default');
                }

                log.debug(`Triggered rule ${rule.name} for ${target}`);

            } catch (e) {
                log.error(`Failed to execute rule ${rule.name}`, e);
            }
        }
    }
};
