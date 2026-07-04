import type { ChatMessage } from '../services/aiService';

export interface ContextUsage {
    /** Tokens do último turno com métricas — amostra de quanto a janela está preenchida. */
    total: number;
    /** Porcentagem (0-100+) de uso relativo à janela de contexto. */
    pct: number;
}

/**
 * Calcula o uso atual da janela de contexto do chat.
 *
 * #967: antes somávamos `usage.totalTokens` de TODAS as mensagens. Cada
 * `totalTokens` já representa a chamada inteira ao modelo (prompt = conversa
 * completa até aquele ponto + completion), então somar contava o histórico
 * várias vezes e inflacionava o percentual — disparando avisos falsos de
 * "contexto acima de 90%" quando o uso real era baixo.
 *
 * O sinal correto é o uso do ÚLTIMO turno que trouxer métricas: cada chamada
 * envia a conversa inteira, então o `totalTokens` mais recente reflete o real
 * preenchimento da janela de contexto.
 */
export function getContextUsage(messages: ChatMessage[], contextWindow: number): ContextUsage {
    let total = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
        const u = messages[i]?.usage;
        if (u && u.totalTokens > 0) {
            total = u.totalTokens;
            break;
        }
    }
    const pct = contextWindow > 0 ? (total / contextWindow) * 100 : 0;
    return { total, pct };
}
