import { toast } from 'sonner';
import { logger } from './logger';

const log = logger.child('notifyError');

/**
 * Mostra uma falha ao usuário em vez de engoli-la no catch (o anti-padrão que escondeu o 401).
 * Use em ações iniciadas pelo usuário: `catch (e) { notifyError('Salvar critério', e); }`.
 * O 401 NÃO gera toast aqui — já é tratado centralmente ("Sessão expirada") no api/core.ts,
 * evitando aviso duplicado.
 */
export function notifyError(context: string, error: any): void {
    const status = error?.response?.status ?? error?.status;
    const msg = error?.response?.data?.message || error?.message || String(error || '');
    log.warn(`${context}: ${msg}`, error);
    if (status === 401 || /\b401\b|unauthor/i.test(String(msg))) return; // sessão expirada já é avisada centralmente
    // id estável por contexto: erros repetidos da mesma ação colapsam num toast só (não empilham).
    toast.error(`${context} falhou.`, { id: `err:${context}`, description: String(msg).slice(0, 160) });
}
