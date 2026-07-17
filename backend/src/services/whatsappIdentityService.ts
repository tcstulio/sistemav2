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
    // `matchStrength: 'full'` = o número COMPLETO (E.164) bate — único caso que ELEVA escrita.
    // (o sufixo-8 é spoofável: outro DDI/DDD com os mesmos 8 dígitos finais viraria o funcionário.)
    | { kind: 'employee'; userId: string; displayName: string; matchStrength: 'full' }
    | { kind: 'customer'; thirdpartyId: string; name: string }
    | { kind: 'unknown' };

const UNKNOWN: SenderIdentity = { kind: 'unknown' };
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Sufixo de 8 dígitos p/ comparação tolerante a DDI/DDD/9º dígito — usado SÓ p/ o lookup de
 * CLIENTE (getThirdPartyByPhone), NÃO para elevar funcionário. Menos de 8 dígitos não identifica.
 */
function phoneSuffix(raw: string | null | undefined): string {
    const digits = String(raw || '').replace(/\D/g, '');
    return digits.length >= 8 ? digits.slice(-8) : '';
}

/**
 * Normaliza um telefone para E.164-BR (55 + DDD + número), comparável dígito-a-dígito.
 * `+5511986781025`, `11 98678-1025` e `5511986781025` colapsam no MESMO valor; um DDD/DDI
 * diferente (spoof com o mesmo sufixo) NÃO. Estrangeiro/atípico: devolve os dígitos como estão
 * (comparação exata). Vazio se não há dígitos suficientes.
 */
function e164br(raw: string | null | undefined): string {
    const d = String(raw || '').replace(/\D/g, '');
    if (d.length < 10) return '';
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d; // já com DDI
    if (d.length === 10 || d.length === 11) return '55' + d;                  // BR sem DDI
    return d;                                                                 // estrangeiro/atípico: exato
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
        const numberPart = senderJid.split('@')[0];
        const suffix = phoneSuffix(numberPart);
        if (!suffix) return UNKNOWN;
        const full = e164br(numberPart);

        // Cache pelo número COMPLETO (não pelo sufixo): dois números com o mesmo sufixo-8 mas
        // DDI/DDD diferentes NÃO podem compartilhar identidade em cache (senão o 2º herda a do 1º
        // e o spoof passa). Fallback p/ sufixo só quando não há número normalizável.
        const cacheKey = full || `suffix:${suffix}`;
        const cached = this.resultCache.get(cacheKey);
        if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.identity;

        // Funcionário (eleva escrita) exige número COMPLETO; cliente (só leitura/CRM) usa sufixo.
        const identity = (await this.matchEmployee(full)) || (await this.matchCustomer(suffix)) || UNKNOWN;
        this.resultCache.set(cacheKey, { at: Date.now(), identity });
        return identity;
    }

    /**
     * Match de FUNCIONÁRIO para ELEVAÇÃO — exige igualdade do número COMPLETO (E.164), não do
     * sufixo-8. Um WhatsApp com os mesmos 8 dígitos finais mas outro DDI/DDD (spoof) NÃO casa.
     * Reconhecimento de LEITURA de cliente segue por sufixo em matchCustomer (inalterado).
     */
    private async matchEmployee(full: string): Promise<SenderIdentity | null> {
        if (!full) return null; // sem número completo normalizável ⇒ não eleva
        const users = await this.getUsers();
        const matches = users.filter(u => {
            // statut vem como string do Dolibarr (mesma pegadinha do admin "1"); só ativo conta
            if (String(u?.statut) !== '1') return false;
            return [u?.user_mobile, u?.phone_mobile].some(p => e164br(p) === full);
        });
        if (matches.length === 1) {
            const u = matches[0];
            const displayName = [u.firstname, u.lastname].filter(Boolean).join(' ') || u.login || `user ${u.id}`;
            return { kind: 'employee', userId: String(u.id), displayName, matchStrength: 'full' };
        }
        if (matches.length > 1) {
            log.warn(`Número completo …${full.slice(-8)} bate com ${matches.length} usuários — ambíguo, tratando como desconhecido.`);
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
