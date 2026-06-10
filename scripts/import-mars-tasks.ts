/**
 * Importa o workflow operacional Mars para o Dolibarr.
 *
 * - Cria 1 projeto (ref: TEMPLATE-MARS-WORKFLOW)
 * - Cria 99 tarefas vinculadas ao projeto, com carga horária planejada (em segundos)
 *   e fiscalizador descrito no campo `description`
 *
 * Execução:
 *   npx tsx scripts/import-mars-tasks.ts
 *
 * Variáveis de ambiente (lidas de backend/.env se existirem, mas o script roda standalone):
 *   DOLIBARR_URL     (default: https://sistema.coolgroove.com.br/api/index.php)
 *   DOLIBARR_API_KEY (obrigatório)
 *   PROJECT_REF      (default: TEMPLATE-MARS-WORKFLOW)
 *   PROJECT_TITLE    (default: Template Mars - Workflow Operacional de Eventos)
 *   DRY_RUN=1        para simular sem chamar a API
 */

import axios, { AxiosError } from 'axios';
import https from 'https';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const DOLIBARR_URL = (process.env.DOLIBARR_URL || 'https://sistema.coolgroove.com.br/api/index.php').replace(/\/+$/, '/');
const DOLIBARR_API_KEY = process.env.DOLIBARR_API_KEY || '26ecc09039bd0bfeb52b11003449a2deb4770482';
const PROJECT_REF = process.env.PROJECT_REF || 'TEMPLATE-MARS-WORKFLOW';
const PROJECT_TITLE = process.env.PROJECT_TITLE || 'Template Mars - Workflow Operacional de Eventos';
const DRY_RUN = process.env.DRY_RUN === '1';

type MarsTask = {
    id: number;
    role: string;
    label: string;
    plannedWorkloadSeconds: number;
    fiscalizador: string;
};

const TASKS: MarsTask[] = [
    { id: 2, role: 'Direção', label: 'Aprovar condições comerciais fora do padrão.', plannedWorkloadSeconds: 0, fiscalizador: 'Produtor Executivo' },
    { id: 3, role: 'Direção', label: 'Aprovar compras de equipamentos e orçamentos extras relevantes.', plannedWorkloadSeconds: 0, fiscalizador: 'Financeiro' },
    { id: 4, role: 'Direção', label: 'Aprovar cancelamentos, remarcações, reembolsos e exceções comerciais.', plannedWorkloadSeconds: 0, fiscalizador: 'Comercial e Produtor Executivo' },
    { id: 5, role: 'Direção', label: 'Controlar documentos legais da casa, como AVCB, alvarás, licenças, ART/RRT e autorizações.', plannedWorkloadSeconds: 0, fiscalizador: 'Comercial e Produtor Executivo' },
    { id: 6, role: 'Direção', label: 'Aprovar alterações em documentos oficiais, Guia Mars, modelos de contrato, checklists e regras operacionais.', plannedWorkloadSeconds: 0, fiscalizador: 'Comercial e Produtor Executivo' },
    { id: 7, role: 'Direção', label: 'Decidir conflitos entre áreas, responsáveis ou fiscalizadores.', plannedWorkloadSeconds: 0, fiscalizador: 'Autorregulação' },
    { id: 8, role: 'Direção', label: 'Fiscalizar os fiscalizadores.', plannedWorkloadSeconds: 0, fiscalizador: 'Autorregulação' },
    { id: 9, role: 'Direção', label: 'Fiscalizar Jurídico, TI, Marketing, Financeiro e Gerente do Espaço.', plannedWorkloadSeconds: 0, fiscalizador: 'Autorregulação' },
    { id: 10, role: 'Direção', label: 'Decidir quem absorve custos gerados por falhas, danos, prejuízos ou retrabalho.', plannedWorkloadSeconds: 0, fiscalizador: 'Autorregulação' },
    { id: 11, role: 'Comercial', label: 'Criar o Terceiro no sistema com dados completos do cliente.', plannedWorkloadSeconds: 6000, fiscalizador: 'Produtor Executivo' },
    { id: 12, role: 'Comercial', label: 'Criar o projeto do evento no sistema desde o prospecto.', plannedWorkloadSeconds: 6000, fiscalizador: 'Produtor Executivo' },
    { id: 13, role: 'Comercial', label: 'Inserir o evento na agenda do sistema e atualizar o status correto.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor Executivo' },
    { id: 14, role: 'Comercial', label: 'Fazer atendimento inicial e levantar briefing comercial inicial.', plannedWorkloadSeconds: 36000, fiscalizador: 'Produtor Executivo' },
    { id: 15, role: 'Comercial', label: 'Criar o orçamento no sistema.', plannedWorkloadSeconds: 9000, fiscalizador: 'Produtor Executivo' },
    { id: 16, role: 'Comercial', label: 'Solicitar validação do Produtor Executivo para itens técnicos, operacionais ou estruturais fora do padrão.', plannedWorkloadSeconds: 6000, fiscalizador: 'Produtor Executivo' },
    { id: 17, role: 'Comercial', label: 'Solicitar aprovação da Direção para condições comerciais fora do padrão.', plannedWorkloadSeconds: 9000, fiscalizador: 'Direção' },
    { id: 18, role: 'Comercial', label: 'Gerar contrato a partir do orçamento aprovado.', plannedWorkloadSeconds: 3000, fiscalizador: 'Direção' },
    { id: 19, role: 'Comercial', label: 'Reunião pré evento.', plannedWorkloadSeconds: 6000, fiscalizador: 'Direção' },
    { id: 20, role: 'Comercial', label: 'Informar ao Comprador, pelo sistema, o que foi vendido em relação a insumos, A&B, bar, camarim, coffee, backstage ou itens de apoio.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor Executivo' },
    { id: 21, role: 'Comercial', label: 'Informar ao Recrutador, pelo sistema, o que foi vendido em termos de equipe/vagas.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor Executivo' },
    { id: 22, role: 'Comercial', label: 'Participar da reunião de finalização da preparação do evento.', plannedWorkloadSeconds: 18000, fiscalizador: 'Produtor Executivo' },
    { id: 23, role: 'Comercial', label: 'Apoiar consultas e pós-venda após o contrato assinado.', plannedWorkloadSeconds: 6000, fiscalizador: 'Direção' },
    { id: 24, role: 'Comercial', label: 'Fiscalizar documentos legais e alterações de documentos oficiais junto com Produtor Executivo, quando aplicável.', plannedWorkloadSeconds: 9000, fiscalizador: 'Direção' },
    { id: 25, role: 'Produtor Executivo', label: 'Entrar no projeto assim que o contrato for assinado.', plannedWorkloadSeconds: 3000, fiscalizador: 'Comercial' },
    { id: 26, role: 'Produtor Executivo', label: 'Analisar contrato, orçamento e escopo e conferir se o que foi vendido é executável.', plannedWorkloadSeconds: 9000, fiscalizador: 'Comercial' },
    { id: 27, role: 'Produtor Executivo', label: 'Transformar contrato e orçamento em lista de entregas no sistema.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor do Evento' },
    { id: 28, role: 'Produtor Executivo', label: 'Criar e distribuir tarefas base do projeto com prazos e previsão de tempo.', plannedWorkloadSeconds: 18000, fiscalizador: 'Produtor do Evento' },
    { id: 29, role: 'Produtor Executivo', label: 'Designar ou contratar o Produtor do Evento e liberar acesso ao projeto.', plannedWorkloadSeconds: 9000, fiscalizador: 'Comercial' },
    { id: 30, role: 'Produtor Executivo', label: 'Definir cachês/valores das vagas.', plannedWorkloadSeconds: 3000, fiscalizador: 'Direção e Financeiro' },
    { id: 31, role: 'Produtor Executivo', label: 'Aprovar cotações feitas pelo Comprador.', plannedWorkloadSeconds: 3000, fiscalizador: 'Direção e Financeiro' },
    { id: 32, role: 'Produtor Executivo', label: 'Aprovar compras, contratações, equipe, custos extras e alterações de escopo.', plannedWorkloadSeconds: 6000, fiscalizador: 'Direção e Financeiro' },
    { id: 33, role: 'Produtor Executivo', label: 'Validar se o evento está financeiramente viável dentro do que foi vendido.', plannedWorkloadSeconds: 6000, fiscalizador: 'Financeiro' },
    { id: 34, role: 'Produtor Executivo', label: 'Acompanhar projeto pelo sistema e cobrar atrasos ou inconsistências.', plannedWorkloadSeconds: 9000, fiscalizador: 'Direção e Financeiro' },
    { id: 35, role: 'Produtor Executivo', label: 'Participar da reunião de finalização e validar escopo, custos, pendências e aprovações.', plannedWorkloadSeconds: 18000, fiscalizador: 'Direção' },
    { id: 36, role: 'Produtor Executivo', label: 'Fiscalizar lançamentos de horas de todos os envolvidos.', plannedWorkloadSeconds: 9000, fiscalizador: 'Direção e Financeiro' },
    { id: 37, role: 'Produtor Executivo', label: 'Lançar pagamentos dos produtores no sistema.', plannedWorkloadSeconds: 3000, fiscalizador: 'Financeiro' },
    { id: 38, role: 'Produtor Executivo', label: 'Dar a última aprovação de pagamento antes do Financeiro pagar.', plannedWorkloadSeconds: 6000, fiscalizador: 'Financeiro' },
    { id: 39, role: 'Financeiro', label: 'Fazer fechamento financeiro do evento.', plannedWorkloadSeconds: 3000, fiscalizador: 'Financeiro' },
    { id: 40, role: 'Produtor Executivo', label: 'Conferir valor do caixa e avisar o Financeiro.', plannedWorkloadSeconds: 3000, fiscalizador: 'Financeiro' },
    { id: 41, role: 'Produtor Executivo', label: 'Substituir o Produtor do Evento se ele não cumprir tarefas ou comprometer a operação.', plannedWorkloadSeconds: 432000, fiscalizador: 'Direção' },
    { id: 42, role: 'Produtor do Evento', label: 'Analisar projeto, contrato, orçamento, lista de entregas e tarefas.', plannedWorkloadSeconds: 9000, fiscalizador: 'Produtor Executivo' },
    { id: 43, role: 'Produtor do Evento', label: 'Confirmar informações da lista de entregas com o cliente.', plannedWorkloadSeconds: 18000, fiscalizador: 'Produtor Executivo e Comercial' },
    { id: 44, role: 'Produtor do Evento', label: 'Centralizar comunicação com o cliente na pré-produção e durante o evento.', plannedWorkloadSeconds: 18000, fiscalizador: 'Produtor Executivo e Comercial' },
    { id: 45, role: 'Produtor do Evento', label: 'Criar tarefas específicas conforme surgirem demandas.', plannedWorkloadSeconds: 6000, fiscalizador: 'Produtor Executivo' },
    { id: 46, role: 'Produtor do Evento', label: 'Distribuir tarefas dentro do projeto do evento.', plannedWorkloadSeconds: 9000, fiscalizador: 'Produtor Executivo' },
    { id: 47, role: 'Produtor do Evento', label: 'Montar cronograma operacional do evento.', plannedWorkloadSeconds: 18000, fiscalizador: 'Produtor Executivo' },
    { id: 48, role: 'Produtor do Evento', label: 'Estar obrigatoriamente presente na reunião de finalização da preparação.', plannedWorkloadSeconds: 15000, fiscalizador: 'Produtor Executivo' },
    { id: 49, role: 'Produtor do Evento', label: 'Aprovar preparação final do evento.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor Executivo' },
    { id: 50, role: 'Produtor do Evento', label: 'Preencher ata da reunião no sistema.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor Executivo' },
    { id: 51, role: 'Produtor do Evento', label: 'Aprovar quantidades finais de insumos sugeridas pelo Comprador.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor Executivo' },
    { id: 52, role: 'Produtor do Evento', label: 'Acompanhar escolhas do Recrutador e aprovar ajustes finais de equipe/vagas.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor Executivo' },
    { id: 53, role: 'Produtor do Evento', label: 'Estar presente ou designar alguém para visitas técnicas.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor Executivo' },
    { id: 54, role: 'Produtor do Evento', label: 'Estar presente da montagem à desmontagem.', plannedWorkloadSeconds: 72000, fiscalizador: 'Produtor Executivo' },
    { id: 55, role: 'Produtor do Evento', label: 'Fazer briefing obrigatório da equipe antes da abertura.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor Executivo' },
    { id: 56, role: 'Produtor do Evento', label: 'Coordenar operação do evento e chefes de setor.', plannedWorkloadSeconds: 252000, fiscalizador: 'Produtor Executivo' },
    { id: 57, role: 'Produtor do Evento', label: 'Pegar dinheiro inicial do caixa com o Zelador e reportar o valor ao Financeiro.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor Executivo e Financeiro' },
    { id: 58, role: 'Produtor do Evento', label: 'Fazer fechamento do caixa do evento.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor Executivo e Financeiro' },
    { id: 59, role: 'Produtor do Evento', label: 'Fazer fechamento das máquinas de cartão.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor Executivo e Financeiro' },
    { id: 60, role: 'Produtor do Evento', label: 'Passar informações de fechamento de caixa e máquinas ao Financeiro.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor Executivo e Financeiro' },
    { id: 61, role: 'Produtor do Evento', label: 'Devolver todas as chaves ao Zelador pós-evento.', plannedWorkloadSeconds: 3000, fiscalizador: 'Zelador' },
    { id: 62, role: 'Produtor do Evento', label: 'Registrar ocorrências, mudanças, custos extras e decisões emergenciais no sistema.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor Executivo e Financeiro' },
    { id: 63, role: 'Produtor do Evento', label: 'Entregar relatório pós-evento.', plannedWorkloadSeconds: 9000, fiscalizador: 'Produtor Executivo' },
    { id: 64, role: 'Produtor do Evento', label: 'Entregar relatório de produção com consumo real do evento.', plannedWorkloadSeconds: 18000, fiscalizador: 'Produtor Executivo' },
    { id: 65, role: 'Produtor do Evento', label: 'Entregar relatório financeiro, danos, equipe, ocorrências e avaliação de fornecedores.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor Executivo' },
    { id: 66, role: 'Produtor do Evento', label: 'Avaliar freelancers/equipe e lançar nota no sistema após o evento.', plannedWorkloadSeconds: 3000, fiscalizador: 'Recrutador' },
    { id: 67, role: 'Produtor do Evento', label: 'Encaminhar comprovantes de pagamento recebidos do Financeiro para freelancers/equipe do evento.', plannedWorkloadSeconds: 6000, fiscalizador: 'Produtor Executivo' },
    { id: 68, role: 'Comprador', label: 'Conferir pelo sistema as informações do Comercial sobre o que foi vendido em insumos e itens de apoio.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor Executivo' },
    { id: 69, role: 'Comprador', label: 'Criar relatório de produção com quantidades e necessidades do evento.', plannedWorkloadSeconds: 9000, fiscalizador: 'Produtor Executivo' },
    { id: 70, role: 'Comprador', label: 'Fazer cotações e comparar fornecedores, preços, prazos e condições.', plannedWorkloadSeconds: 18000, fiscalizador: 'Produtor Executivo' },
    { id: 71, role: 'Comprador', label: 'Submeter cotações para aprovação do Produtor Executivo.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor Executivo' },
    { id: 72, role: 'Comprador', label: 'Encaminhar compras para aprovação do Produtor Executivo e Financeiro.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor Executivo e Financeiro' },
    { id: 73, role: 'Comprador', label: 'Executar ou encaminhar compra aprovada conforme fluxo.', plannedWorkloadSeconds: 6000, fiscalizador: 'Produtor Executivo e Financeiro' },
    { id: 74, role: 'Comprador', label: 'Acompanhar entrega dos itens comprados.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor do Evento' },
    { id: 75, role: 'Comprador', label: 'Avisar atrasos, erros, faltas ou divergências pelo sistema.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor do Evento e Produtor Executivo' },
    { id: 76, role: 'Comprador', label: 'Atualizar estoque após entrega conferida pelo Zelador.', plannedWorkloadSeconds: 9000, fiscalizador: 'Gerente do Espaço' },
    { id: 77, role: 'Comprador', label: 'Participar da reunião de finalização da preparação.', plannedWorkloadSeconds: 18000, fiscalizador: 'Produtor Executivo' },
    { id: 78, role: 'Comprador', label: 'Bater quantidades de insumos na reunião de finalização.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor do Evento e Produtor Executivo' },
    { id: 79, role: 'Recrutador', label: 'Organizar vagas do evento no sistema.', plannedWorkloadSeconds: 9000, fiscalizador: 'Produtor Executivo' },
    { id: 80, role: 'Recrutador', label: 'Divulgar vagas no banco de freelancers.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor Executivo' },
    { id: 81, role: 'Recrutador', label: 'Escolher freelancers para as vagas.', plannedWorkloadSeconds: 18000, fiscalizador: 'Produtor Executivo' },
    { id: 82, role: 'Recrutador', label: 'Avisar o Produtor do Evento sobre os freelancers escolhidos.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor do Evento' },
    { id: 83, role: 'Recrutador', label: 'Confirmar presença dos freelancers um dia antes do evento.', plannedWorkloadSeconds: 6000, fiscalizador: 'Produtor do Evento' },
    { id: 84, role: 'Recrutador', label: 'Substituir faltas ou desistências.', plannedWorkloadSeconds: 6000, fiscalizador: 'Produtor do Evento' },
    { id: 85, role: 'Recrutador', label: 'Garantir que contratos sejam gerados no sistema.', plannedWorkloadSeconds: 9000, fiscalizador: 'Produtor Executivo' },
    { id: 86, role: 'Recrutador', label: 'Participar da reunião de finalização da preparação.', plannedWorkloadSeconds: 18000, fiscalizador: 'Produtor Executivo' },
    { id: 87, role: 'Recrutador', label: 'Bater vagas/equipe na reunião de finalização.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor do Evento e Produtor Executivo' },
    { id: 88, role: 'Recrutador', label: 'Fiscalizar se o Produtor do Evento avaliou freelancers/equipe e lançou notas no sistema.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor Executivo' },
    { id: 89, role: 'Produtor Técnico', label: 'Planejar som, luz, vídeo/LED, palco, energia, backstage e passagem de som.', plannedWorkloadSeconds: 18000, fiscalizador: 'Produtor do Evento e Produtor Executivo' },
    { id: 90, role: 'Produtor Técnico', label: 'Criar mapa técnico do evento.', plannedWorkloadSeconds: 18000, fiscalizador: 'Produtor do Evento e Produtor Executivo' },
    { id: 91, role: 'Produtor Técnico', label: 'Alinhar com técnicos e fornecedores técnicos.', plannedWorkloadSeconds: 18000, fiscalizador: 'Produtor do Evento' },
    { id: 92, role: 'Produtor Técnico', label: 'Solicitar compras, locações ou contratações técnicas ao Produtor do Evento.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor do Evento' },
    { id: 93, role: 'Produtor Técnico', label: 'Coordenar equipe técnica no evento.', plannedWorkloadSeconds: 57600, fiscalizador: 'Produtor do Evento' },
    { id: 94, role: 'Produtor Técnico', label: 'Reportar riscos, inviabilidades, falhas e necessidades de manutenção.', plannedWorkloadSeconds: 6000, fiscalizador: 'Produtor do Evento' },
    { id: 95, role: 'Produtor de Montagem', label: 'Coordenar montagem e desmontagem.', plannedWorkloadSeconds: 288000, fiscalizador: 'Produtor do Evento e Produtor Executivo' },
    { id: 96, role: 'Produtor de Montagem', label: 'Validar qualquer mudança de layout com o Produtor do Evento antes de executar.', plannedWorkloadSeconds: 3000, fiscalizador: 'Produtor do Evento' },
    { id: 97, role: 'Produtor de Montagem', label: 'Entregar relatório de montagem/desmontagem ao Produtor do Evento.', plannedWorkloadSeconds: 6000, fiscalizador: 'Produtor do Evento' },
    { id: 98, role: 'Técnico Operacional / Técnico da Casa', label: 'Testar som, mesa, microfones, cabos, luz, DMX, LED/vídeo, energia e equipamentos antes do evento.', plannedWorkloadSeconds: 72000, fiscalizador: 'Produtor do Evento' },
    { id: 99, role: 'Técnico Operacional / Técnico da Casa', label: 'Acompanhar operação técnica durante o evento.', plannedWorkloadSeconds: 288000, fiscalizador: 'Produtor do Evento' },
    { id: 100, role: 'Técnico Operacional / Técnico da Casa', label: 'Guardar equipamentos, cabos, microfones, extensões e materiais no local correto após o uso.', plannedWorkloadSeconds: 72000, fiscalizador: 'Produtor do Evento e Zelador' },
];

const headers = {
    'DOLAPIKEY': DOLIBARR_API_KEY,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Cookie': 'humans_21909=1',
};

async function dolibarrPost<T = any>(path: string, body: any): Promise<T> {
    if (DRY_RUN) return { id: -1, dryRun: true } as unknown as T;
    let res;
    try {
        res = await axios.post(`${DOLIBARR_URL}${path}`, body, { headers, httpsAgent, validateStatus: () => true });
    } catch (err) {
        const ax = err as AxiosError;
        const detail = (ax.response as any)?.data ?? ax.message;
        throw new Error(`POST ${path} falhou (rede): ${typeof detail === 'string' ? detail.slice(0, 300) : JSON.stringify(detail).slice(0, 300)}`);
    }
    if (res.status >= 200 && res.status < 300) return res.data as T;
    const detail = res.data === undefined || res.data === null ? '(sem corpo)' : typeof res.data === 'string' ? res.data.slice(0, 300) : JSON.stringify(res.data).slice(0, 300);
    throw new Error(`HTTP ${res.status} ${detail}`);
}

async function findProjectByRef(ref: string): Promise<string | null> {
    if (DRY_RUN) return null;
    try {
        const res = await axios.get(`${DOLIBARR_URL}projects`, {
            headers,
            params: { sqlfilters: `(t.ref:like:'${ref}')`, limit: 5 },
            httpsAgent,
            validateStatus: () => true,
        });
        if (res.status === 200 && Array.isArray(res.data)) {
            const match = res.data.find((p: any) => p.ref === ref) || res.data[0];
            if (match) return String(match.id);
        }
        return null;
    } catch {
        return null;
    }
}

function formatDuration(seconds: number): string {
    if (!seconds) return '0h';
    const h = seconds / 3600;
    if (h >= 1) return `${h.toFixed(h % 1 === 0 ? 0 : 2)}h`;
    const m = seconds / 60;
    return `${m.toFixed(0)}min`;
}

function buildTaskPayload(t: MarsTask, projectId: string) {
    return {
        ref: `MARS-${String(t.id).padStart(3, '0')}`,
        label: `[${t.role}] ${t.label}`,
        description: `ID da planilha: ${t.id}\nÁrea responsável: ${t.role}\nFiscalizador: ${t.fiscalizador}\nCarga horária planejada: ${formatDuration(t.plannedWorkloadSeconds)} (${t.plannedWorkloadSeconds}s)\n\nDescrição: ${t.label}`,
        fk_projet: Number(projectId),
        planned_workload: t.plannedWorkloadSeconds,
        progress: 0,
    };
}

async function main() {
    console.log('=== Importador Mars → Dolibarr ===');
    console.log(`URL:       ${DOLIBARR_URL}`);
    console.log(`Ref:       ${PROJECT_REF}`);
    console.log(`Título:    ${PROJECT_TITLE}`);
    console.log(`Tarefas:   ${TASKS.length}`);
    console.log(`Modo:      ${DRY_RUN ? 'DRY-RUN (não chama API)' : 'PRODUÇÃO'}`);
    console.log('');

    let projectId = await findProjectByRef(PROJECT_REF);
    if (projectId) {
        console.log(`✔ Projeto já existe (id=${projectId}, ref=${PROJECT_REF}) — reutilizando.`);
    } else {
        console.log(`Criando projeto "${PROJECT_REF}"...`);
        const created = await dolibarrPost<{ id: string | number }>('projects', {
            ref: PROJECT_REF,
            title: PROJECT_TITLE,
            description: 'Template de projeto gerado a partir da planilha "tarefas_mars_reorganizadas_comprador_recrutador_adequada". Cada linha da planilha virou uma tarefa deste projeto, com fiscalizador e carga horária planejada preservados.',
            status: 1,
        });
        projectId = String(created.id);
        console.log(`✔ Projeto criado: id=${projectId}`);
    }

    console.log('');
    let ok = 0;
    let fail = 0;
    for (const t of TASKS) {
        const payload = buildTaskPayload(t, projectId!);
        const ref = `MARS-${String(t.id).padStart(3, '0')}`;
        try {
            const created = await dolibarrPost<{ id: string | number }>('tasks', payload);
            ok++;
            console.log(`  [${String(ok + fail).padStart(2, '0')}/${TASKS.length}] ✔ ${ref} (taskId=${created.id}) — ${t.label.slice(0, 60)}`);
        } catch (err: any) {
            fail++;
            console.error(`  [${String(ok + fail).padStart(2, '0')}/${TASKS.length}] ✖ ${ref} — ${err.message}`);
        }
    }

    console.log('');
    console.log(`=== Concluído ===`);
    console.log(`Projeto:   ${PROJECT_REF} (id=${projectId})`);
    console.log(`Tarefas:   ${ok} OK, ${fail} falhas de ${TASKS.length}`);
    if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
    console.error('Erro fatal:', err);
    process.exit(1);
});
