/**
 * Tabela de preços por modelo (USD por 1k tokens).
 *
 * Fonte: páginas oficiais de pricing de cada provider (jun/2026).
 * - Google Gemini: https://ai.google.dev/pricing
 * - Z.AI / GLM: https://docs.z.ai/guides/overview/quick-start
 * - MiniMax: https://platform.MiniMax.io/docs/pricing/quickstart
 * - Ollama/Local: grátis (0)
 *
 * Default = 0 para modelos desconhecidos (não bloqueia o pipeline).
 * Adicionar novos modelos aqui à medida que forem suportados.
 */

export interface ModelPricing {
    inputPer1k: number;
    outputPer1k: number;
}

const PRICING: Record<string, ModelPricing> = {
    // Google Gemini
    'gemini-2.0-flash-exp': { inputPer1k: 0.0, outputPer1k: 0.0 },
    'gemini-2.0-flash':     { inputPer1k: 0.0001, outputPer1k: 0.0004 },
    'gemini-2.5-flash':     { inputPer1k: 0.0003, outputPer1k: 0.0025 },
    'gemini-2.5-pro':       { inputPer1k: 0.00125, outputPer1k: 0.01 },
    'gemini-1.5-flash':     { inputPer1k: 0.000075, outputPer1k: 0.0003 },
    'gemini-1.5-pro':       { inputPer1k: 0.00125, outputPer1k: 0.005 },

    // Z.AI / GLM
    'glm-5.2':              { inputPer1k: 0.001, outputPer1k: 0.001 },
    'glm-5.1':              { inputPer1k: 0.001, outputPer1k: 0.001 },
    'glm-4.6':              { inputPer1k: 0.0006, outputPer1k: 0.0022 },
    'glm-4.5':              { inputPer1k: 0.0006, outputPer1k: 0.0022 },
    'glm-4.6v':             { inputPer1k: 0.0006, outputPer1k: 0.0022 },

    // MiniMax
    'MiniMax-M3':           { inputPer1k: 0.001, outputPer1k: 0.008 },
    'MiniMax-M2':           { inputPer1k: 0.001, outputPer1k: 0.008 },
    'MiniMax-M1':           { inputPer1k: 0.001, outputPer1k: 0.008 },

    // Local (Ollama) — gratuito
    'llama3':               { inputPer1k: 0, outputPer1k: 0 },
    'llama3.1':             { inputPer1k: 0, outputPer1k: 0 },
    'qwen2.5':              { inputPer1k: 0, outputPer1k: 0 },
    'mistral':              { inputPer1k: 0, outputPer1k: 0 },
    'deepseek-coder':       { inputPer1k: 0, outputPer1k: 0 },
};

const DEFAULT_PRICING: ModelPricing = { inputPer1k: 0, outputPer1k: 0 };

/**
 * Retorna o preço por 1k tokens para um modelo.
 * Match é case-insensitive e tolerante a variações (-latest, versões, etc.).
 */
export function getPricing(modelName: string | undefined): ModelPricing {
    if (!modelName) return DEFAULT_PRICING;
    const key = modelName.toLowerCase();
    if (PRICING[key]) return PRICING[key];
    for (const [k, v] of Object.entries(PRICING)) {
        if (key.includes(k)) return v;
    }
    return DEFAULT_PRICING;
}

/**
 * Calcula o custo em USD dado tokens de input e output.
 */
export function calcCostUsd(modelName: string | undefined, promptTokens: number, completionTokens: number): number {
    const p = getPricing(modelName);
    const cost = (promptTokens / 1000) * p.inputPer1k + (completionTokens / 1000) * p.outputPer1k;
    return Math.round(cost * 1e6) / 1e6; // 6 casas de precisão
}
