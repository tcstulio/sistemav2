import { describe, it, expect } from 'vitest';
import { parseAppRoutes, affectedScreensFromMap, affectedScreens } from '../../utils/affectedScreens';

// Amostra representativa do App.tsx (mesma forma das ~122 rotas reais). Puro — sem fs.
const SAMPLE_APP = `
    <Route path="/" element={<ViewWrapper Component={Dashboard} viewId="dashboard" />} />
    <Route path="/customers" element={<ViewWrapper Component={CustomerList} viewId="customers" />} />
    <Route path="/customers/new" element={<ViewWrapper Component={CustomerList} viewId="customers" />} />
    <Route path="/customers/:id" element={<ViewWrapper Component={CustomerList} viewId="customers" />} />
    <Route path="/invoices/:id/edit" element={<ViewWrapper Component={InvoiceList} viewId="invoices" />} />
    <Route path="/invoices" element={<ViewWrapper Component={InvoiceList} viewId="invoices" />} />
    <Route path="/orders" element={<ViewWrapper Component={OrderList} viewId="orders" />} />
`;

describe('parseAppRoutes (App.tsx → componente→rota)', () => {
    const map = parseAppRoutes(SAMPLE_APP);

    it('extrai a rota BASE de cada componente', () => {
        expect(map['Dashboard']).toBe('/');
        expect(map['CustomerList']).toBe('/customers');
        expect(map['InvoiceList']).toBe('/invoices');
        expect(map['OrderList']).toBe('/orders');
    });

    it('prefere a rota BASE (lista) sobre a de detalhe, independente da ordem', () => {
        // InvoiceList aparece primeiro como /invoices/:id/edit, depois /invoices — vence a base.
        expect(map['InvoiceList']).toBe('/invoices');
    });
});

describe('affectedScreensFromMap (arquivos alterados → telas)', () => {
    const map = parseAppRoutes(SAMPLE_APP);

    it('mapeia componentes de lista para suas rotas', () => {
        expect(affectedScreensFromMap(['src/components/InvoiceList.tsx'], map)).toEqual(['/invoices']);
        expect(affectedScreensFromMap(['src/components/CustomerList.tsx'], map)).toEqual(['/customers']);
    });

    it('componente COMPARTILHADO sem rota não casa (degrada p/ fallback)', () => {
        expect(affectedScreensFromMap(['src/components/ui/Button.tsx'], map)).toEqual([]);
    });

    it('ignora não-frontend e não-.tsx', () => {
        expect(affectedScreensFromMap(['backend/src/x.ts', 'README.md', 'docs/y.md'], map)).toEqual([]);
    });

    it('dedup + múltiplos + barra invertida (Windows)', () => {
        const r = affectedScreensFromMap(['src\\components\\InvoiceList.tsx', 'src/components/OrderList.tsx', 'backend/z.ts'], map);
        expect(r).toContain('/invoices');
        expect(r).toContain('/orders');
        expect(r.length).toBe(2);
    });
});

describe('affectedScreens (integração — lê o App.tsx real do repo)', () => {
    it('não lança e devolve array (mapa real do repo)', () => {
        // No ambiente do vitest o fs pode estar mockado → devolve []; o importante é NÃO lançar.
        expect(Array.isArray(affectedScreens(['src/components/InvoiceList.tsx']))).toBe(true);
    });
});
