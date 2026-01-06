

export const DB_NAME = 'CoolGrooveDB';
export const DB_VERSION = 29; // Bumped version to include User Rights

// ... (existing code)

const STORES = [
    'customers', 'suppliers', 'categories', 'contacts', 'invoices',
    'supplierInvoices', 'supplierProposals', 'products', 'proposals', 'orders', 'shipments',
    'projects', 'tasks', 'bankAccounts', 'bankLines', 'events',
    'users', 'supplierOrders', 'interventions', 'expenseReports',
    'jobPositions', 'tickets', 'warehouses', 'stockMovements', 'candidates',
    'leaveRequests', 'contracts', 'payments', 'supplierPayments',
    'boms', 'manufacturingOrders', 'systemLogs',
    'api_logs',
    'pending_sync',
    // Line item stores
    'links',
    'proposalLines',
    'supplierProposalLines',
    'orderLines',
    'invoiceLines',
    'shipmentLines',
    'supplierOrderLines',
    'supplierInvoiceLines',
    'interventionLines',
    'bomLines',
    'taskTimeLogs', // Added missing Task Time Logs
    'taskContacts', // Added missing Task Contacts
    'expenseReportLines', // Added Expense Report Lines
    'expenseTypes', // Added Expense Types Dictionary
    // Payment Stores
    'paymentInvoiceLinks',
    'supplierPaymentInvoiceLinks',
    'expenseReportPayments', // Added missing store
    'expenseReportPaymentLinks', // Added missing store
    'vatPayments', // Added missing store
    'salaryPayments', // Added missing store
    'socialContributionPayments', // Added missing store
    'loanPayments', // Added missing store
    'variousPayments', // Added missing store
    'projectContacts', // Added Project Contacts for visibility
    'groups', // Added User Groups
    'groupUsers', // Added User-Group Links
    'permissions', // Added Permissions
    'groupRights', // Added Group Rights
    'userRights', // Added User Rights
    'leads', // Added Leads
];

export const dbService = {
    dbPromise: null as Promise<IDBDatabase> | null,

    open: () => {
        if (dbService.dbPromise) return dbService.dbPromise;

        dbService.dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event: any) => {
                const db = event.target.result;
                const oldVersion = event.oldVersion;

                // Force re-sync of main objects that now have project_id
                if (oldVersion < 15) {
                    console.log("Upgrading to v15: Clearing stores to force re-sync of project links...");
                    const storesToClear = ['proposals', 'orders', 'invoices', 'contracts', 'tickets', 'events'];
                    storesToClear.forEach(store => {
                        if (db.objectStoreNames.contains(store)) {
                            db.deleteObjectStore(store); // Deleting forces creation below which is effectively a clear
                        }
                    });
                }

                // v16: Force re-sync of other objects that now have project_id (Shipments, Supplier Orders, etc.)
                if (oldVersion < 16) {
                    console.log("Upgrading to v16: Clearing stores to force re-sync of extended project links...");
                    const storesToClear = ['shipments', 'supplierOrders', 'supplierInvoices', 'expenseReports'];
                    storesToClear.forEach(store => {
                        if (db.objectStoreNames.contains(store)) {
                            db.deleteObjectStore(store);
                        }
                    });
                }

                // v18: Force re-sync of payments to fetch new fields (mode, note, num_paiement)
                if (oldVersion < 18) {
                    console.log("Upgrading to v18: Clearing payment stores to force re-sync of new fields...");
                    const storesToClear = ['payments', 'supplierPayments'];
                    storesToClear.forEach(store => {
                        if (db.objectStoreNames.contains(store)) {
                            db.deleteObjectStore(store);
                        }
                    });
                }

                // v19 - Force re-sync of payments to fix bank account mapping (transaction_id vs bank_account_id)
                if (oldVersion < 19) {
                    console.log("Upgrading to v19 - Clearing payments for bank account ID fix");
                    const storesToClear = ['payments', 'supplierPayments'];
                    storesToClear.forEach(storeName => {
                        if (db.objectStoreNames.contains(storeName)) {
                            db.deleteObjectStore(storeName);
                        }
                    });
                }

                // v20 - Ensure new payment stores exist (automatic via STORES loop below, but we can log or force clear if we wanted)
                if (oldVersion < 20) {
                    console.log("Upgrading to v20 - Creating detailed payment stores");
                    // No need to delete/clear unless we want to force re-fetch.
                    // New stores will be created by the STORES loop.
                }

                // v23 - Force re-sync of users to fetch supervisor_id
                if (oldVersion < 23) {
                    console.log("Upgrading to v23 - Clearing users to fetch hierarchy...");
                    if (db.objectStoreNames.contains('users')) {
                        db.deleteObjectStore('users');
                    }
                }

                // v24 - Add projectContacts store
                if (oldVersion < 24) {
                    console.log("Upgrading to v24 - Adding projectContacts store...");
                    // Store creation happens in the loop below
                }

                // v25 - Force re-sync of taskContacts to fix user_id mapping
                if (oldVersion < 25) {
                    console.log("Upgrading to v25 - Clearing taskContacts for re-sync...");
                    if (db.objectStoreNames.contains('taskContacts')) {
                        db.deleteObjectStore('taskContacts');
                    }
                }

                STORES.forEach(storeName => {
                    if (!db.objectStoreNames.contains(storeName)) {
                        // Using 'id' as keyPath is standard for our types
                        db.createObjectStore(storeName, { keyPath: 'id' });
                    }
                });
            };

            request.onsuccess = (event: any) => {
                resolve(event.target.result);
            };

            request.onerror = (event: any) => {
                console.error("IndexedDB error:", event.target.error);
                reject(event.target.error);
            };
        });

        return dbService.dbPromise;
    },

    getAll: async <T>(storeName: string): Promise<T[]> => {
        try {
            const db = await dbService.open();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(storeName, 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.getAll();

                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => {
                    resolve([]);
                };
            });
        } catch (e) {
            return [];
        }
    },

    // Helper to fetch single item (needed for corrections)
    get: async <T>(storeName: string, id: string): Promise<T | undefined> => {
        try {
            const db = await dbService.open();
            return new Promise((resolve) => {
                const transaction = db.transaction(storeName, 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.get(id);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(undefined);
            });
        } catch (e) {
            return undefined;
        }
    },

    // UPSERT (Insert or Update) without clearing the store
    upsertAll: async (storeName: string, items: any[]) => {
        if (!items || items.length === 0) return;
        try {
            const db = await dbService.open();
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);

            items.forEach(item => {
                if (item && item.id) {
                    store.put(item);
                }
            });

            return new Promise<void>((resolve, reject) => {
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
            });
        } catch (e) {
            console.error(`Error upserting to ${storeName}`, e);
        }
    },

    saveAll: async (storeName: string, items: any[]) => {
        if (!items || items.length === 0) return;
        try {
            const db = await dbService.open();
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);

            // Do not clear critical logs or queue unless specifically requested via clearAll
            // For sync operations, we usually want to overwrite or update.
            // Ideally we should use put() without clearing to allow incremental updates, 
            // but for this architecture we clear to remove stale data from server
            if (storeName !== 'api_logs' && storeName !== 'pending_sync') {
                store.clear();
            }

            items.forEach(item => {
                if (item && item.id) {
                    store.put(item);
                }
            });

            return new Promise<void>((resolve, reject) => {
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
            });
        } catch (e) {
            console.error(`Error saving to ${storeName}`, e);
        }
    },

    // Helper to add/update single item (used for logs and corrections)
    add: async (storeName: string, item: any) => {
        try {
            const db = await dbService.open();
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            store.put(item);
            return new Promise<void>((resolve, reject) => {
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
            });
        } catch (e) {
            console.error(`Error adding to ${storeName}`, e);
        }
    },

    clearAll: async () => {
        try {
            const db = await dbService.open();
            const transaction = db.transaction(STORES, 'readwrite');
            STORES.forEach(storeName => {
                if (db.objectStoreNames.contains(storeName)) {
                    transaction.objectStore(storeName).clear();
                }
            });
            return new Promise<void>((resolve, reject) => {
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
            });
        } catch (e) {
            console.error("Failed to clear DB", e);
        }
    },

    deleteDatabase: async () => {
        return new Promise<void>((resolve, reject) => {
            if (dbService.dbPromise) {
                dbService.dbPromise = null;
            }
            const req = indexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = () => resolve();
            req.onerror = () => reject();
        });
    },

    getStorageStats: async (): Promise<Record<string, number>> => {
        try {
            const db = await dbService.open();
            const stats: Record<string, number> = {};
            const promises = STORES.map(storeName => {
                return new Promise<void>((resolve) => {
                    if (!db.objectStoreNames.contains(storeName)) {
                        resolve();
                        return;
                    }
                    const transaction = db.transaction(storeName, 'readonly');
                    const store = transaction.objectStore(storeName);
                    const countRequest = store.count();

                    countRequest.onsuccess = () => {
                        stats[storeName] = countRequest.result;
                        resolve();
                    };
                    countRequest.onerror = () => {
                        stats[storeName] = -1;
                        resolve();
                    };
                });
            });
            await Promise.all(promises);
            return stats;
        } catch (e) {
            return {};
        }
    },

    // NEW: Export entire DB to JSON string
    exportToJson: async (): Promise<string> => {
        const exportData: Record<string, any[]> = {};

        try {
            const db = await dbService.open();
            const promises = STORES.map(storeName => {
                return new Promise<void>((resolve) => {
                    const transaction = db.transaction(storeName, 'readonly');
                    const store = transaction.objectStore(storeName);
                    const request = store.getAll();
                    request.onsuccess = () => {
                        exportData[storeName] = request.result;
                        resolve();
                    };
                    request.onerror = () => resolve();
                });
            });

            await Promise.all(promises);
            return JSON.stringify(exportData);
        } catch (e) {
            console.error("Export failed", e);
            throw new Error("Failed to export database");
        }
    },

    // NEW: Import from JSON string
    importFromJson: async (jsonString: string): Promise<void> => {
        try {
            const data = JSON.parse(jsonString);
            const db = await dbService.open();
            const transaction = db.transaction(STORES, 'readwrite');

            const promises = Object.keys(data).map(storeName => {
                return new Promise<void>((resolve, reject) => {
                    if (!STORES.includes(storeName)) {
                        resolve(); // Skip unknown stores
                        return;
                    }
                    const store = transaction.objectStore(storeName);
                    store.clear(); // Wipe existing data for clean import

                    const items = data[storeName];
                    if (Array.isArray(items)) {
                        items.forEach(item => store.put(item));
                    }
                    resolve();
                });
            });

            await Promise.all(promises);

            return new Promise((resolve, reject) => {
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
            });
        } catch (e) {
            console.error("Import failed", e);
            throw new Error("Failed to import database. Invalid file format.");
        }
    },

    // NEW: Get the latest modification timestamp from a store
    getLastModified: async (storeName: string, dateField: string = 'date_modification'): Promise<number> => {
        try {
            const items = await dbService.getAll<any>(storeName);
            if (!items || items.length === 0) return 0;

            let maxTs = 0;
            items.forEach(item => {
                // Check multiple possible timestamp fields
                const ts = item[dateField] || item.tms || item.datec || item.date_creation || 0;
                const val = Number(ts);
                if (!isNaN(val) && val > maxTs) {
                    maxTs = val;
                }
            });
            return maxTs;
        } catch (e) {
            console.error(`Failed to get last modified for ${storeName}`, e);
            return 0;
        }
    }
};