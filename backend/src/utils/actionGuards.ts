/**
 * Guardas de governança de AÇÃO (Fase A do docs/PLANO_GOVERNANCA_ACAO.md).
 * Funções PURAS (testáveis) usadas pelos pontos de efeito externo (send_whatsapp,
 * notify_person, POST /notifications/send, validate_*).
 *
 * Princípio (auditoria A0): allowlist VAZIA = comportamento atual intacto (mandar WhatsApp
 * p/ cliente é feature testada e o scheduler fala com cliente como produto). A restrição só
 * passa a existir quando o admin a CONFIGURA. Nunca aplicar no channelRouter/messageService
 * (quebraria o scheduler e o chat de WhatsApp da UI) — só na camada de TOOL/rota.
 */

/** Normaliza telefone para apenas dígitos (padrão do repo: replace(/\D/g,'')). */
export function normalizePhone(p: unknown): string {
    return String(p ?? '').replace(/\D/g, '');
}

/**
 * Lê a allowlist de destino de WhatsApp do ui_config de forma DEFENSIVA: o bloco
 * `actionGovernance` só nasce no #1200 (Fase B1) — até lá (ou se ausente) devolve [].
 * Itens são normalizados p/ dígitos; entradas < 8 dígitos são descartadas.
 */
export function getWhatsappAllowlist(cfg: unknown): string[] {
    const raw = (cfg as any)?.actionGovernance?.whatsappDestinationAllowlist;
    if (!Array.isArray(raw)) return [];
    return raw.map((x) => normalizePhone(x)).filter((d) => d.length >= 8 && d.length <= 15);
}

/**
 * Allowlist de destino: VAZIA => permite tudo (default de fábrica, preserva o comportamento
 * atual); NÃO-vazia => o destino precisa constar (comparação por dígitos normalizados).
 */
export function whatsappDestinationAllowed(phone: unknown, allowlist: string[]): boolean {
    if (!allowlist.length) return true;
    const d = normalizePhone(phone);
    return allowlist.includes(d);
}

/** Canais externos (saem do sistema) — o resto (in-app) é benigno/reversível. */
export function externalChannelsOf(channels: unknown): string[] {
    const arr = Array.isArray(channels) ? channels.map(String) : [];
    return arr.filter((c) => c === 'whatsapp' || c === 'email');
}

/** True se o telefone pertence a algum usuário do sistema (compara dígitos dos campos de fone). */
export function phoneBelongsToUser(phone: unknown, users: Array<Record<string, unknown>>): boolean {
    const d = normalizePhone(phone);
    if (!d) return false;
    return users.some((u) => [u['user_mobile'], u['phone_mobile'], u['office_phone'], u['personal_mobile']]
        .some((f) => f != null && normalizePhone(f) === d));
}

/** True se o e-mail pertence a algum usuário do sistema (case-insensitive). */
export function emailBelongsToUser(email: unknown, users: Array<Record<string, unknown>>): boolean {
    const e = String(email ?? '').trim().toLowerCase();
    if (!e) return false;
    return users.some((u) => String(u['email'] ?? '').trim().toLowerCase() === e);
}

/** Extrai o socid (cliente) de uma entidade Dolibarr (invoice/order/proposal). */
export function socidOf(entity: unknown): string | null {
    const e = entity as any;
    const v = e?.socid ?? e?.fk_soc ?? e?.fk_socid ?? null;
    return v == null ? null : String(v);
}
