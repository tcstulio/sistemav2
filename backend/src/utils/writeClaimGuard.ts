/**
 * Guarda contra SUCESSO ALUCINADO de ação de escrita (#1332).
 *
 * Incidente (2026-07-11): o usuário pediu "valide a proposta 303" e o modelo respondeu
 * "Proposta 303 validada com sucesso ✅" SEM ter chamado nenhuma ferramenta — a proposta
 * seguia rascunho. Prompt não é gate; esta é a régua DETERMINÍSTICA: se a resposta final
 * AFIRMA sucesso de uma ação de escrita e NENHUMA tool mutante rodou no turno, o loop
 * intercepta (retry com instrução dura; persistindo, disclaimer prefixado).
 *
 * Util PURO (regex, sem imports de services) — testável isolado.
 */

// Particípios/afirmações de ação de escrita CONCLUÍDA, em pt-BR. A âncora é o par
// (verbo de escrita no particípio) + (sinal de conclusão: "com sucesso", "✅", entidade #id,
// "status atualizado"). Verbos soltos em outra função ("foi criado em 2024", citações) são
// tolerados: o guard só dispara quando NENHUMA tool mutante rodou — o falso positivo custa
// um retry; o falso negativo custa uma mentira ao usuário.
const WRITE_PARTICIPLES = [
    'validad', 'criad', 'enviad', 'atualizad', 'excluid', 'excluíd', 'deletad', 'removid',
    'cadastrad', 'registrad', 'gerad', 'emitid', 'aprovad', 'confirmad', 'salv', 'marcad',
    'convertid', 'faturad', 'cancelad', 'agendad', 'alterad', 'editad', 'movid', 'transferid',
    // 1ª pessoa do pretérito (red-team #1332): o LLM alucina "Cadastrei você, seu código é X"
    // — os particípios acima NÃO casavam essa forma conjugada, então a mentira passava livre.
    // Entradas já normalizadas (norm() tira acento): 'excluí'→'exclui'. Substring-match, então
    // formas já cobertas por um particípio (ex.: 'emiti'⊂'emitido') são redundantes-inócuas.
    'criei', 'cadastrei', 'validei', 'enviei', 'atualizei', 'exclui', 'registrei', 'emiti',
    'agendei', 'gerei', 'paguei', 'confirmei', 'deletei', 'apaguei', 'faturei',
    'cancelei', 'editei', 'alterei', 'salvei', 'marquei', 'converti',
];

const SUCCESS_SIGNALS = [
    'com sucesso', '✅', 'status atualizado', 'foi conclu', 'realizada com', 'realizado com',
    'já está valid', 'já foi', 'pronto!', 'feito!', 'concluído!', 'concluída!',
];

/** Normaliza p/ matching: minúsculas + sem acento (validad[ao] casa "validada"/"validado"). */
function norm(t: string): string {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * True se o texto AFIRMA sucesso de uma ação de escrita (particípio de escrita + sinal de
 * conclusão na mesma resposta). Perguntas/ofertas ("quer que eu valide?") não disparam:
 * exigimos o par completo, e "quer que" / "posso" / "deseja" na MESMA frase do particípio anula.
 */
export function claimsWriteSuccess(text: string): boolean {
    const t = norm(text);
    if (!t) return false;

    const hasParticiple = WRITE_PARTICIPLES.some((p) => t.includes(p));
    if (!hasParticiple) return false;

    const hasSignal = SUCCESS_SIGNALS.some((s) => t.includes(norm(s)));
    if (!hasSignal) return false;

    // Ofertas/perguntas não são afirmação: se TODA ocorrência de particípio está em frase
    // interrogativa/condicional, não conta. Heurística barata: presença forte de oferta.
    const sentences = t.split(/[.!?\n]/);
    const affirmative = sentences.some((s) =>
        WRITE_PARTICIPLES.some((p) => s.includes(p)) &&
        !/quer que|posso |deseja |gostaria|devo |caso queira|\?$/.test(s.trim()),
    );
    return affirmative;
}

/** Instrução dura injetada no retry (1 chance de se corrigir). */
export const WRITE_CLAIM_RETRY_INSTRUCTION =
    '[SISTEMA — VIOLAÇÃO DETECTADA] Sua resposta AFIRMA que uma ação de escrita foi realizada, ' +
    'mas NENHUMA ferramenta de escrita foi executada neste turno — a ação NÃO aconteceu no sistema. ' +
    'É PROIBIDO afirmar sucesso sem executar. Decida AGORA: (a) execute a ferramenta correta emitindo ' +
    'APENAS o JSON {"tool":"nome","args":{...}}; ou (b) responda ao usuário dizendo explicitamente que ' +
    'a ação NÃO foi realizada e o que falta para realizá-la. NUNCA afirme que fez o que não fez.';

/** Disclaimer prefixado quando o modelo insiste na alucinação (fail-safe honesto). */
export const WRITE_CLAIM_DISCLAIMER =
    '⚠️ **ATENÇÃO: nenhuma ação foi executada no sistema neste turno.** A resposta abaixo pode ' +
    'afirmar o contrário — desconsidere qualquer alegação de que algo foi validado/criado/enviado.\n\n';
