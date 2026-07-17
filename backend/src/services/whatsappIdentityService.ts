import { dolibarrService } from './dolibarrService';
import { logger } from '../utils/logger';

const log = logger.child('WhatsappIdentity');

/**
 * Identidade do remetente de uma mensagem de WhatsApp, resolvida por telefone.
 *
 * Decide o contexto de permissões do agente no botService: funcionário identificado
 * pode ganhar o próprio perfil de permissões (com HITL preservado); cliente ganha
 * contexto CRM em somente-leitura; desconhecido fica em somente-leitura sem contexto.
 */
export type SenderIdentity =
    | { kind: 'employee'; userId: string; displayName: string }
    | { kind: 'customer'; thirdpartyId: string; name: string }
    | { kind: 'unknown' };

const UNKNOWN: SenderIdentity = { kind: 'unknown' };
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Sufixo de 8 dígitos p/ comparação tolerante a DDI/DDD/9º dígito — mesma convenção
 * do getThirdPartyByPhone. Menos de 8 dígitos não identifica ninguém com segurança.
 */
function phoneSuffix(raw: string | null | undefined): string {
    const digits = String(raw || '').replace(/\D/g, '');
    return digits.length >= 8 ? digits.slice(-8) : '';
}

class WhatsappIdentityService {
    private usersCache: { at: number; users: any[] } | null = null;
    private resultCache = new Map<string, { at: number; identity: SenderIdentity }>();

    /**
     * Identifica o remetente a partir do JID real (realSender, já com @lid resolvido).
     * Fail-closed: JID que não é @c.us (grupo, @lid não resolvido), número curto ou
     * match ambíguo ⇒ unknown.
     */
    async identifySender(senderJid: string | null | undefined): Promise<SenderIdentity> {
        if (!senderJid || !senderJid.endsWith('@c.us')) return UNKNOWN;
        const suffix = phoneSuffix(senderJid.split('@')[0]);
        if (!suffix) return UNKNOWN;

        const cached = this.resultCache.get(suffix);
        if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.identity;

        const identity = (await this.matchEmployee(suffix)) || (await this.matchCustomer(suffix)) || UNKNOWN;
        this.resultCache.set(suffix, { at: Date.now(), identity });
        return identity;
    }

    private async matchEmployee(suffix: string): Promise<SenderIdentity | null> {
        const users = await this.getUsers();
        const matches = users.filter(u => {
            // statut vem como string do Dolibarr (mesma pegadinha do admin "1"); só ativo conta
            if (String(u?.statut) !== '1') return false;
            return [u?.user_mobile, u?.phone_mobile].some(p => phoneSuffix(p) === suffix);
        });
        if (matches.length === 1) {
            const u = matches[0];
            const displayName = [u.firstname, u.lastname].filter(Boolean).join(' ') || u.login || `user ${u.id}`;
            return { kind: 'employee', userId: String(u.id), displayName };
        }
        if (matches.length > 1) {
            log.warn(`Telefone …${suffix} bate com ${matches.length} usuários — ambíguo, tratando como desconhecido.`);
        }
        return null;
    }

    private async matchCustomer(suffix: string): Promise<SenderIdentity | null> {
        try {
            const customer = await dolibarrService.getThirdPartyByPhone(suffix);
            if (customer?.id) {
                return { kind: 'customer', thirdpartyId: String(customer.id), name: customer.name || '' };
            }
        } catch (e: any) {
            log.warn(`Lookup de cliente falhou p/ …${suffix}: ${e?.message}`);
        }
        return null;
    }

    private async getUsers(): Promise<any[]> {
        if (this.usersCache && Date.now() - this.usersCache.at < CACHE_TTL_MS) return this.usersCache.users;
        const users = await dolibarrService.listAllUsers();
        // lista vazia pode ser falha transitória do Dolibarr — não cachear (fail-closed sem congelar)
        if (users.length > 0) this.usersCache = { at: Date.now(), users };
        return users;
    }

    /** Só para testes. */
    clearCache() {
        this.usersCache = null;
        this.resultCache.clear();
    }
}

export const whatsappIdentityService = new WhatsappIdentityService();
