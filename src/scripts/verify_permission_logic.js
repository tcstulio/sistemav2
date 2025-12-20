
// Mocking the logic from DolibarrContext.tsx to run in node (JS Version)

const canAccess = (currentUser, moduleName) => {
    if (!currentUser) return false;
    if (moduleName === 'dashboard') return true;
    if (currentUser.admin === 1 || currentUser.admin === '1' || currentUser.admin === true) return true;
    if (!currentUser.rights) return false;

    const rightsMap = {
        // CRM
        'customers': { module: 'societe', perms: ['lire', 'read', 'client.voir'] },
        'suppliers': { module: 'fournisseur', perms: ['lire', 'read', 'facture.lire'] },
        'contacts': { module: 'contact', perms: ['lire', 'read'] },
        // Sales / Finance
        'proposals': { module: 'propale', perms: ['lire', 'read'] },
        'orders': { module: 'commande', perms: ['lire', 'read'] },
        'invoices': { module: 'facture', perms: ['lire', 'read'] },
        'payments': { module: 'facture', perms: ['lire', 'read'] },
        'contracts': { module: 'contrat', perms: ['lire', 'read'] },
        'supplier_orders': { module: 'fournisseur', perms: ['commande.lire'] },
        'supplier_invoices': { module: 'fournisseur', perms: ['facture.lire'] },
        // Projects / Operations
        'projects': { module: 'projet', perms: ['lire', 'read'] },
        'tasks': { module: 'projet', perms: ['lire', 'read'] },
        'interventions': { module: 'ficheinter', perms: ['lire', 'read'] },
        'agenda': { module: 'agenda', perms: ['myevent.read', 'allactions.read'] },
        // Stock / Product
        'products': { module: 'produit', perms: ['lire', 'read'] },
        'services': { module: 'service', perms: ['lire', 'read'] },
        'inventory': { module: 'stock', perms: ['lire', 'read'] },
        'shipments': { module: 'expedition', perms: ['lire', 'read'] },
        'warehouses': { module: 'stock', perms: ['lire', 'read'] },
        'movements': { module: 'stock', perms: ['mouvement.lire'] },
        'manufacturing': { module: 'mrp', perms: ['read', 'lire'] },
        'boms': { module: 'bom', perms: ['read', 'lire'] },
        // HR / Admin
        'users': { module: 'user', perms: ['user.lire', 'user.read', 'self.read'] },
        'hr': { module: 'holiday', perms: ['read', 'lire'] },
        'tickets': { module: 'ticket', perms: ['read', 'lire'] },
        'bank_accounts': { module: 'banque', perms: ['lire', 'read'] },
        'categories': { module: 'categorie', perms: ['lire', 'read'] },
    };

    const mapping = rightsMap[moduleName];
    if (mapping) {
        const moduleRights = currentUser.rights[mapping.module];
        if (!moduleRights) return false;

        for (const perm of mapping.perms) {
            if (perm.includes('.')) {
                const parts = perm.split('.');
                let currentLevel = moduleRights;
                let found = true;
                for (const part of parts) {
                    if (currentLevel && typeof currentLevel === 'object' && currentLevel[part] !== undefined) {
                        currentLevel = currentLevel[part];
                    } else {
                        found = false;
                        break;
                    }
                }
                if (found && (currentLevel === "1" || currentLevel === 1 || currentLevel === true)) return true;
            } else {
                if (moduleRights[perm] === "1" || moduleRights[perm] === 1 || moduleRights[perm] === true) return true;
            }
        }
        return false;
    }

    if (currentUser.rights[moduleName]) {
        const r = currentUser.rights[moduleName];
        if (r.read || r.lire || r.consulter) return true;
    }
    return false;
};

// --- TESTS ---
const performTest = (name, user, moduleName, expected) => {
    try {
        const result = canAccess(user, moduleName);
        console.log(`${result === expected ? 'PASS' : 'FAIL'}: ${name} (Expected ${expected}, got ${result})`);
        if (result !== expected) {
            console.log('User Perms:', JSON.stringify(user, null, 2));
        }
    } catch (e) {
        console.log(`ERROR: ${name}`, e);
    }
};

console.log('=== STARTING PERMISSION TESTS (JS) ===');

// 1. Admin
performTest('Admin should access customers', { admin: 1, rights: {} }, 'customers', true);

// 2. Simple Permissions
performTest('Basic societe lire', { admin: 0, rights: { societe: { lire: '1' } } }, 'customers', true);

// 4. Nested Permissions 
performTest('Nested client.voir', { admin: 0, rights: { societe: { client: { voir: '1' } } } }, 'customers', true);

// 5. Complex mappings 
performTest('Supplier Invoices (facture.lire)', { admin: 0, rights: { fournisseur: { facture: { lire: '1' } } } }, 'supplier_invoices', true);

// 6. Test Failures 
performTest('Partial path failure', { admin: 0, rights: { fournisseur: { facture: '1' } } }, 'supplier_invoices', false);

// 7. Users module (Self read vs User read)
performTest('User Self Read', { admin: 0, rights: { user: { self: { read: '1' } } } }, 'users', true);

console.log('=== TESTS COMPLETED ===');
