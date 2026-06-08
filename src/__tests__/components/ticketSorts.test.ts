import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useListControls } from '../../hooks/useListControls';
import { mapTicket } from '../../hooks/dolibarr/mappers';
import { ticketSorts, TICKET_DATE_SORT_KEY } from '../../components/TicketList.sorts';

// Auditoria (#121): a ordenação por "Data" do TicketList usava `t.date_c`, mas mapTicket
// popula `t.datec` (date_c fica undefined) — todos comparam 0 e a ordenação é um no-op.
// Usa a config REAL do componente (ticketSorts) + o hook real (useListControls).
describe('TicketList — ordenação por Data (#121/auditoria)', () => {
    const tickets = [
        { id: 1, ref: 'TK-A', subject: 'a', datec: 1000 },
        { id: 2, ref: 'TK-B', subject: 'b', datec: 3000 },
        { id: 3, ref: 'TK-C', subject: 'c', datec: 2000 },
    ].map(mapTicket);

    it('mapTicket popula datec, nunca date_c (causa-raiz)', () => {
        expect(tickets.every((t) => typeof t.datec === 'number' && t.datec > 0)).toBe(true);
        expect(tickets.every((t) => t.date_c === undefined)).toBe(true);
    });

    it('ordena os tickets por Data (desc) usando a config real do componente', () => {
        const { result } = renderHook(() =>
            useListControls(tickets, {
                searchText: (t) => t.ref,
                sorts: ticketSorts,
                initialSortKey: TICKET_DATE_SORT_KEY,
                initialSortDir: 'desc',
            })
        );
        // Mais novo (datec 3000) primeiro; mais antigo (1000) por último.
        expect(result.current.result.map((t) => t.ref)).toEqual(['TK-B', 'TK-C', 'TK-A']);
    });
});
