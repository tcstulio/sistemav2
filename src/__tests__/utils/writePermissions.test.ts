import { describe, it, expect } from 'vitest';
import { canDoAction, WRITE_MAP } from '../../utils/writePermissions';

// Helper: identidade não-admin com os direitos informados.
const user = (rights: any) => ({ admin: 0, rights });
const admin = (rights: any = {}) => ({ admin: 1, rights });

describe('canDoAction — contrato base', () => {
    it('ident ausente => false', () => {
        expect(canDoAction(null, 'invoices', 'create')).toBe(false);
        expect(canDoAction(undefined, 'invoices', 'create')).toBe(false);
    });

    it('admin sempre bypassa (1, "1" ou true)', () => {
        for (const a of [{ admin: 1 }, { admin: '1' }, { admin: true }]) {
            expect(canDoAction(a, 'supplier_invoices', 'pay')).toBe(true);
            expect(canDoAction(a, 'centrovibe', 'create')).toBe(true);
        }
    });

    it('rights não carregados => NÃO bloqueia (default seguro)', () => {
        expect(canDoAction({ admin: 0 }, 'invoices', 'create')).toBe(true);
        expect(canDoAction({ admin: 0, rights: undefined }, 'centrovibe', 'delete')).toBe(true);
    });

    it('tela não mapeada => NÃO bloqueia', () => {
        expect(canDoAction(user({}), 'tela_inexistente', 'create')).toBe(true);
    });

    it('ação sem perm mapeada nessa tela => NÃO bloqueia', () => {
        // warehouses mapeia create/delete/edit mas não validate
        expect(canDoAction(user({ stock: {} }), 'warehouses', 'validate')).toBe(true);
    });
});

describe('canDoAction — supplier_invoices (#850)', () => {
    // direitos reais do Dolibarr: module 'fournisseur', perms aninhados em fournisseur.facture.*
    const rights = {
        fournisseur: { facture: { paiement: 1, valider: 1 } },
    };

    it('pay: admin true / usuário com direito true / sem direito false', () => {
        expect(canDoAction(admin(), 'supplier_invoices', 'pay')).toBe(true);
        expect(canDoAction(user(rights), 'supplier_invoices', 'pay')).toBe(true);
        expect(canDoAction(user({ fournisseur: { facture: { paiement: 0 } } }), 'supplier_invoices', 'pay')).toBe(false);
        expect(canDoAction(user({ fournisseur: { facture: {} } }), 'supplier_invoices', 'pay')).toBe(false);
    });

    it('validate: admin true / usuário com direito true / sem direito false', () => {
        expect(canDoAction(admin(), 'supplier_invoices', 'validate')).toBe(true);
        expect(canDoAction(user(rights), 'supplier_invoices', 'validate')).toBe(true);
        expect(canDoAction(user({ fournisseur: { facture: { valider: 0 } } }), 'supplier_invoices', 'validate')).toBe(false);
    });

    it('reopen: usa o mesmo perm que validate (facture.valider)', () => {
        expect(WRITE_MAP.supplier_invoices.reopen).toBe('facture.valider');
        expect(canDoAction(admin(), 'supplier_invoices', 'reopen')).toBe(true);
        expect(canDoAction(user(rights), 'supplier_invoices', 'reopen')).toBe(true);
        expect(canDoAction(user({ fournisseur: { facture: { valider: 0 } } }), 'supplier_invoices', 'reopen')).toBe(false);
    });

    it('create/delete pré-existentes continuam funcionando (regressão)', () => {
        const r = user({ fournisseur: { facture: { creer: 1, supprimer: 1 } } });
        expect(canDoAction(r, 'supplier_invoices', 'create')).toBe(true);
        expect(canDoAction(r, 'supplier_invoices', 'delete')).toBe(true);
        expect(canDoAction(user({ fournisseur: { facture: { creer: 0 } } }), 'supplier_invoices', 'create')).toBe(false);
    });
});

describe('canDoAction — warehouses edit (#850)', () => {
    // edit mapeado para o perm 'stock' do module 'stock' (rights.stock.stock).
    it('edit: admin true / usuário com direito true / sem direito false', () => {
        expect(canDoAction(admin(), 'warehouses', 'edit')).toBe(true);
        expect(canDoAction(user({ stock: { stock: 1 } }), 'warehouses', 'edit')).toBe(true);
        expect(canDoAction(user({ stock: { stock: 0 } }), 'warehouses', 'edit')).toBe(false);
        expect(canDoAction(user({ stock: {} }), 'warehouses', 'edit')).toBe(false);
        expect(canDoAction(user({}), 'warehouses', 'edit')).toBe(false);
    });

    it('edit respeita o campo próprio (não cai em create) — perm "stock"', () => {
        expect(WRITE_MAP.warehouses.edit).toBe('stock');
        // usuário com creer (create) mas SEM stock => edit bloqueado
        expect(canDoAction(user({ stock: { creer: 1 } }), 'warehouses', 'edit')).toBe(false);
    });
});

describe('canDoAction — centrovibe (#850)', () => {
    // feature custom do app (module 'centrovibe', perm 'centrovibe' => rights.centrovibe.centrovibe).
    const rights = { centrovibe: { centrovibe: 1 } };

    it('create/edit/delete: admin true / usuário com direito true / sem direito false', () => {
        for (const action of ['create', 'edit', 'delete'] as const) {
            expect(canDoAction(admin(), 'centrovibe', action)).toBe(true);
            expect(canDoAction(user(rights), 'centrovibe', action)).toBe(true);
            expect(canDoAction(user({ centrovibe: { centrovibe: 0 } }), 'centrovibe', action)).toBe(false);
            expect(canDoAction(user({}), 'centrovibe', action)).toBe(false);
        }
    });

    it('antes desta tarefa centrovibe não era mapeado (agora está)', () => {
        expect(WRITE_MAP.centrovibe).toBeDefined();
        expect(WRITE_MAP.centrovibe.module).toBe('centrovibe');
    });
});

describe('canDoAction — regressão de telas pré-existentes', () => {
    it('invoices: validate/pagamento aninhados no module facture', () => {
        const r = user({ facture: { creer: 1, supprimer: 1, valider: 1, paiement: 1 } });
        expect(canDoAction(r, 'invoices', 'create')).toBe(true);
        expect(canDoAction(r, 'invoices', 'validate')).toBe(true);
        expect(canDoAction(r, 'invoices', 'pay')).toBe(true);
        expect(canDoAction(r, 'invoices', 'delete')).toBe(true);
        // edit sem campo próprio => cai em create (creer)
        expect(canDoAction(r, 'invoices', 'edit')).toBe(true);
    });

    it('contacts: perm aninhado contact.creer/contact.supprimer', () => {
        const r = user({ societe: { contact: { creer: 1, supprimer: 0 } } });
        expect(canDoAction(r, 'contacts', 'create')).toBe(true);
        expect(canDoAction(r, 'contacts', 'delete')).toBe(false);
    });

    it('edit sem campo próprio usa create (comportamento preservado)', () => {
        const comCreate = user({ societe: { creer: 1 } });
        const semCreate = user({ societe: { creer: 0 } });
        expect(canDoAction(comCreate, 'customers', 'edit')).toBe(true);
        expect(canDoAction(semCreate, 'customers', 'edit')).toBe(false);
    });
});

describe('canDoAction — users (RH: delete-user #1416)', () => {
    // Direitos reais do Dolibarr: module 'user', perms aninhadas em user.user.<perm>.
    const rights = { user: { user: { lire: 1, creer: 1, supprimer: 1 } } };

    it('delete: admin true / usuário com direito true / sem direito false', () => {
        expect(canDoAction(admin(), 'users', 'delete')).toBe(true);
        expect(canDoAction(user(rights), 'users', 'delete')).toBe(true);
        expect(canDoAction(user({ user: { user: { supprimer: 0 } } }), 'users', 'delete')).toBe(false);
        expect(canDoAction(user({ user: { user: {} } }), 'users', 'delete')).toBe(false);
        expect(canDoAction(user({ user: {} }), 'users', 'delete')).toBe(false);
        expect(canDoAction(user({}), 'users', 'delete')).toBe(false);
    });

    it('create: usuário com droit true / sem droit false', () => {
        expect(canDoAction(user(rights), 'users', 'create')).toBe(true);
        expect(canDoAction(user({ user: { user: { creer: 0 } } }), 'users', 'create')).toBe(false);
    });

    it('edit usa create (creer) quando há o perm', () => {
        expect(canDoAction(user(rights), 'users', 'edit')).toBe(true);
        expect(canDoAction(user({ user: { user: { creer: 0 } } }), 'users', 'edit')).toBe(false);
    });
});
