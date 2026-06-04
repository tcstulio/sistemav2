import { DolibarrConfig } from '../types';
import { DolibarrService } from './dolibarrService';

// Registro de criação EM LOTE (Opção B do #117). Mapeia o `entity` do deeplink batch_create
// para a função de criação do frontend (reusa as mesmas que os modais individuais usam),
// mantendo o HITL: a criação roda no navegador com a auth do usuário ao confirmar a tela.

const toUnix = (d?: string): number | undefined =>
    d ? Math.floor(new Date(d).getTime() / 1000) : undefined;

// Normaliza linhas (entidades com itens) p/ o formato esperado pelas APIs de criação.
const mapLines = (lines: any[] = []) =>
    (Array.isArray(lines) ? lines : []).map((l) => ({
        fk_product: l.fk_product || undefined,
        desc: l.desc,
        qty: Number(l.qty) || 1,
        subprice: Number(l.subprice) || 0,
        remise_percent: l.remise_percent !== undefined ? Number(l.remise_percent) : undefined,
        product_type: 0,
    }));

export interface BatchEntityDef {
    label: string;
    create: (config: DolibarrConfig, item: any) => Promise<any>;
}

export const BATCH_ENTITIES: Record<string, BatchEntityDef> = {
    customer: { label: 'Cliente', create: (c, it) => DolibarrService.createThirdParty(c, { client: '1', ...it }) },
    supplier: { label: 'Fornecedor', create: (c, it) => DolibarrService.createThirdParty(c, { fournisseur: '1', client: '0', ...it }) },
    contact: { label: 'Contato', create: (c, it) => DolibarrService.createContact(c, it) },
    product: { label: 'Produto/Serviço', create: (c, it) => DolibarrService.createProduct(c, it) },
    project: { label: 'Projeto', create: (c, it) => DolibarrService.createProject(c, it) },
    task: { label: 'Tarefa', create: (c, it) => DolibarrService.createTask(c, { ...it, date_start: toUnix(it.date_start), date_end: toUnix(it.date_end) }) },
    ticket: { label: 'Ticket', create: (c, it) => DolibarrService.createTicket(c, it) },
    category: { label: 'Categoria', create: (c, it) => DolibarrService.createCategory(c, it) },
    candidate: { label: 'Candidato', create: (c, it) => DolibarrService.createCandidate(c, it) },
    job: { label: 'Vaga', create: (c, it) => DolibarrService.createJobPosition(c, it) },
    event: { label: 'Evento', create: (c, it) => DolibarrService.createEvent(c, it) },
    intervention: { label: 'Intervenção', create: (c, it) => DolibarrService.createIntervention(c, { ...it, date: toUnix(it.date) }) },
    contract: { label: 'Contrato', create: (c, it) => DolibarrService.createContract(c, { ...it, date_contrat: toUnix(it.date_contrat), date_fin_validite: toUnix(it.date_fin_validite) }) },
    bom: { label: 'BOM', create: (c, it) => DolibarrService.createBOM(c, it) },
    mo: { label: 'Ordem de Produção', create: (c, it) => DolibarrService.createManufacturingOrder(c, { ...it, date_start: toUnix(it.date_start) }) },
    user: { label: 'Usuário', create: (c, it) => DolibarrService.createUser(c, it) },
    group: { label: 'Grupo', create: (c, it) => DolibarrService.createGroup(c, it) },
    expense: { label: 'Despesa', create: (c, it) => DolibarrService.createExpenseReport(c, { ...it, date_debut: toUnix(it.date_debut), date_fin: toUnix(it.date_fin) }) },
    leave: { label: 'Licença/Férias', create: (c, it) => DolibarrService.createLeaveRequest(c, { ...it, date_debut: toUnix(it.date_debut), date_fin: toUnix(it.date_fin) }) },
    // Entidades com LINHAS (documentos):
    invoice: { label: 'Fatura', create: (c, it) => DolibarrService.createInvoice(c, { ...it, date: toUnix(it.date), lines: mapLines(it.lines) }) },
    proposal: { label: 'Proposta', create: (c, it) => DolibarrService.createProposal(c, { ...it, date: toUnix(it.date), lines: mapLines(it.lines) }) },
    order: { label: 'Pedido de Venda', create: (c, it) => DolibarrService.createOrder(c, { ...it, date: toUnix(it.date), lines: mapLines(it.lines) }) },
    supplier_invoice: { label: 'Fatura de Fornecedor', create: (c, it) => DolibarrService.createSupplierInvoice(c, { ...it, date: toUnix(it.date), lines: mapLines(it.lines) }) },
    supplier_proposal: { label: 'Solicitação de Preço', create: (c, it) => DolibarrService.createSupplierProposal(c, { ...it, date: toUnix(it.date), lines: mapLines(it.lines) }) },
};

export const getBatchEntity = (entity: string): BatchEntityDef | undefined => BATCH_ENTITIES[entity];
