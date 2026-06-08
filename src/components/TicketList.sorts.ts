import type { Ticket } from '../types';
import type { SortOption } from '../hooks/useListControls';

// Opções de ordenação da lista de Tickets (#121). Extraído do TicketList para permitir
// teste de regressão da ordenação por data.
// Usa `datec` (campo que o mapTicket popula) — NÃO `date_c`, que é alias legado e fica
// sempre undefined, tornando a ordenação por Data um no-op (bug corrigido na auditoria).
export const TICKET_DATE_SORT_KEY = 'datec';

export const ticketSorts: SortOption<Ticket>[] = [
    { key: 'datec', label: 'Data', get: (t) => t.datec || 0 },
    { key: 'ref', label: 'Referência', get: (t) => t.ref },
    { key: 'subject', label: 'Assunto', get: (t) => t.subject },
];
