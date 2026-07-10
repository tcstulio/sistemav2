// Smoke-test do gate de LEITURA (VER) — roda em node, sem UI.
//
// De-dup (#1073): este script ANTES re-implementava o canAccess + um rightsMap próprio (uma 3ª cópia
// que já havia defasado). Agora ele exercita a FONTE CANÔNICA `canAccessScreen` (src/utils/screenAccess.ts)
// diretamente — se a lógica viva mudar, este smoke-test acompanha, sem risco de divergir.
//
// Uso:  npx tsx src/scripts/verify_permission_logic.ts

import { canAccessScreen, AccessIdentity } from '../utils/screenAccess';

const canAccess = (user: AccessIdentity | null, screenId: string): boolean => canAccessScreen(user, screenId);

// --- TESTS ---

let failures = 0;
const performTest = (name: string, user: AccessIdentity, module: string, expected: boolean) => {
    const result = canAccess(user, module);
    const ok = result === expected;
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}: ${name} (Expected ${expected}, got ${result})`);
    if (!ok) {
        console.log('User Perms:', JSON.stringify(user, null, 2));
    }
};

console.log('=== STARTING PERMISSION TESTS ===');

// 1. Admin
performTest('Admin should access customers', { admin: 1, rights: {} }, 'customers', true);
performTest('Admin string should access customers', { admin: '1', rights: {} }, 'customers', true);
performTest('Admin bool should access customers', { admin: true, rights: {} }, 'customers', true);
performTest('Non-admin empty rights should NOT access customers', { admin: 0, rights: {} }, 'customers', false);

// 2. Simple Permissions
performTest('Basic societe lire', { admin: 0, rights: { societe: { lire: '1' } } }, 'customers', true);

// 3. Alternate Permission Names
performTest('Basic societe read', { admin: 0, rights: { societe: { read: '1' } } }, 'customers', true);

// 4. Nested Permissions (Critical Test) — 'customers' aceita 'client.voir'
performTest('Nested client.voir', { admin: 0, rights: { societe: { client: { voir: '1' } } } }, 'customers', true);

// 5. Complex mappings — 'supplier_invoices' -> fournisseur / facture.lire
performTest('Supplier Invoices (facture.lire)', { admin: 0, rights: { fournisseur: { facture: { lire: '1' } } } }, 'supplier_invoices', true);

// 6. Test Failures (Partial paths)
performTest('Partial path failure', { admin: 0, rights: { fournisseur: { facture: '1' } } }, 'supplier_invoices', false);

// 7. Users module (Self read vs User read) — 'users' -> ['user.lire','user.read','self.read']
performTest('User Self Read', { admin: 0, rights: { user: { self: { read: '1' } } } }, 'users', true);

// 8. Unmapped module fallback — tenta rights[screen].read/lire/consulter
performTest('Unmapped Fallback', { admin: 0, rights: { unknown_proto: { lire: 1 } } }, 'unknown_proto', true);

// 9. Superset do de-dup (#1073): telas que ANTES só existiam na cópia inline do DolibarrContext
performTest('reports segue facture', { admin: 0, rights: { facture: { lire: '1' } } }, 'reports', true);
performTest('whatsapp segue societe', { admin: 0, rights: { societe: { lire: '1' } } }, 'whatsapp', true);
performTest('settings segue user.self.read', { admin: 0, rights: { user: { self: { read: '1' } } } }, 'settings', true);
performTest('freela NÃO vê settings', { admin: 0, rights: {} }, 'settings', false);

console.log(`=== TESTS COMPLETED (${failures} failure(s)) ===`);
if (failures > 0) process.exit(1);
