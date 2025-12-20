
// Mocking the types and logic from DolibarrContext.tsx to run in node
// This script simulates the `canAccess` function to verify its correctness

type MockUser = {
    admin: any;
    rights: any;
};

// --- LOGIC EXTRACTED FROM DolibarrContext.tsx (Simplified for testing) ---
const canAccess = (currentUser: MockUser | null, module: string): boolean => {
    if (!currentUser) return false;
    // 0. Public Modules
    if (module === 'dashboard') return true;

    // 1. Admin Override
    if (currentUser.admin === 1 || currentUser.admin === '1' || currentUser.admin === true) return true;

    if (!currentUser.rights) {
        return false;
    }

    const rightsMap: Record<string, { module: string, perms: string[] }> = {
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
        'movements': { module: 'stock', perms: ['mouvement.lire'] }, // Note check here
        'manufacturing': { module: 'mrp', perms: ['read', 'lire'] },
        'boms': { module: 'bom', perms: ['read', 'lire'] },

        // HR / Admin
        'users': { module: 'user', perms: ['user.lire', 'user.read', 'self.read'] },
        'hr': { module: 'holiday', perms: ['read', 'lire'] },
        'tickets': { module: 'ticket', perms: ['read', 'lire'] },
        'bank_accounts': { module: 'banque', perms: ['lire', 'read'] },
        'categories': { module: 'categorie', perms: ['lire', 'read'] },
    };

    const mapping = rightsMap[module];
    if (mapping) {
        const moduleRights = currentUser.rights[mapping.module];
        if (!moduleRights) return false;

        for (const perm of mapping.perms) {
            if (perm.includes('.')) {
                const parts = perm.split('.');
                let currentLevel: any = moduleRights;
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
                // Flattened 'read' or 'lire' check
                // IMPORTANT: The original code iterates. 
                // If mapping.perms has mixed nested and simple, this loop handles both.
                if ((moduleRights[perm] as any) === "1" || (moduleRights[perm] as any) === 1 || (moduleRights[perm] as any) === true) return true;
            }
        }
        return false;
    }

    // Default fallback
    if (currentUser.rights[module]) {
        const r = currentUser.rights[module];
        if (r.read || r.lire || r.consulter) return true;
    }
    return false;
};

// --- TESTS ---

const performTest = (name: string, user: MockUser, module: string, expected: boolean) => {
    const result = canAccess(user, module);
    console.log(`${result === expected ? 'PASS' : 'FAIL'}: ${name} (Expected ${expected}, got ${result})`);
    if (result !== expected) {
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
const userBasics = {
    admin: 0,
    rights: {
        societe: { lire: '1' } // French 'read'
    }
};
performTest('Basic societe lire', userBasics, 'customers', true);

// 3. Alternate Permission Names
const userEnglish = {
    admin: 0,
    rights: {
        societe: { read: '1' }
    }
};
performTest('Basic societe read', userEnglish, 'customers', true);

// 4. Nested Permissions (Critical Test)
const userNested = {
    admin: 0,
    rights: {
        societe: {
            client: {
                voir: '1'
            }
        }
    }
};
// 'customers' maps to 'client.voir' as one option. 'societe' module.
performTest('Nested client.voir', userNested, 'customers', true);

// 5. Complex mappings (Supplier Invoice)
// 'supplier_invoices' -> module 'fournisseur', perm 'facture.lire'
const userSupplierInv = {
    admin: 0,
    rights: {
        fournisseur: {
            facture: {
                lire: '1'
            }
        }
    }
};
performTest('Supplier Invoices (facture.lire)', userSupplierInv, 'supplier_invoices', true);

// 6. Test Failures (Partial paths)
const userBroken = {
    admin: 0,
    rights: {
        fournisseur: {
            facture: '1' // Missing 'lire' nested level if it expects facture.lire
        }
    }
};
performTest('Partial path failure', userBroken, 'supplier_invoices', false);

// 7. Users module (Self read vs User read)
// 'users' -> perms: ['user.lire', 'user.read', 'self.read']
const userSelf = {
    admin: 0,
    rights: {
        user: {
            self: { read: '1' }
        }
    }
};
performTest('User Self Read', userSelf, 'users', true);

// 8. Unmapped module fallback
// 'unknown_module' -> Logic tries rights['unknown_module'].read/lire/consulter
const userFallback = {
    admin: 0,
    rights: {
        unknown_proto: { lire: 1 }
    }
};
performTest('Unmapped Fallback', userFallback, 'unknown_proto', true);

console.log('=== TESTS COMPLETED ===');
