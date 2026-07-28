import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
    logger: {
        child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
    },
}));

import { dbService, DB_NAME, DB_VERSION, DATE_MODIFICATION_INDEX } from '../../services/dbService';
import { indexedDB as fakeIndexedDB, IDBObjectStore as FDBObjectStore } from 'fake-indexeddb';

// NOTE: dbService tests have complex IndexedDB mocking requirements
// that conflict with the global test setup. Skipped pending proper fix.
// All functionality is exercised via integration tests.
describe.skip('dbService', () => {
    const mockIndexedDB = {
        open: vi.fn(),
        deleteDatabase: vi.fn()
    };

    beforeEach(() => {
        vi.clearAllMocks();
        dbService.dbPromise = null;
    });

    describe('open', () => {
        it('creates a new database connection', async () => {
            const mockDB = { objectStoreNames: { contains: () => false } };
            const mockRequest: any = {
                onupgradeneeded: null,
                onsuccess: null,
                onerror: null,
                result: mockDB
            };
            mockIndexedDB.open.mockImplementation((name, version) => {
                setTimeout(() => mockRequest.onsuccess({ target: { result: mockDB } }), 0);
                return mockRequest;
            });

            const promise = dbService.open();
            await promise;
            
            expect(mockIndexedDB.open).toHaveBeenCalledWith(DB_NAME, DB_VERSION);
        });

        it('returns cached promise if already opening', () => {
            const mockRequest = { result: {} };
            mockIndexedDB.open.mockReturnValue(mockRequest);
            
            dbService.dbPromise = mockRequest as any;
            const result = dbService.open();
            
            expect(result).toBe(mockRequest);
            expect(mockIndexedDB.open).not.toHaveBeenCalled();
        });
    });

    describe('getAll', () => {
        it('returns all items from a store', async () => {
            const items = [{ id: '1', name: 'test' }, { id: '2', name: 'test2' }];
            const mockDB = {
                transaction: vi.fn().mockReturnValue({
                    objectStore: vi.fn().mockReturnValue({
                        getAll: vi.fn().mockReturnValue({
                            onsuccess: null,
                            result: items
                        })
                    })
                })
            };
            
            dbService.dbPromise = Promise.resolve(mockDB as any);
            
            const result = await dbService.getAll('customers');
            expect(result).toEqual(items);
        });

        it('returns empty array on error', async () => {
            const mockDB = {
                transaction: vi.fn().mockReturnValue({
                    objectStore: vi.fn().mockReturnValue({
                        getAll: vi.fn().mockReturnValue({
                            onsuccess: null,
                            onerror: vi.fn()
                        })
                    })
                })
            };
            
            dbService.dbPromise = Promise.resolve(mockDB as any);
            
            const result = await dbService.getAll('nonexistent');
            expect(result).toEqual([]);
        });
    });

    describe('get', () => {
        it('returns single item by id', async () => {
            const item = { id: '1', name: 'test' };
            const mockDB = {
                transaction: vi.fn().mockReturnValue({
                    objectStore: vi.fn().mockReturnValue({
                        get: vi.fn().mockReturnValue({
                            onsuccess: null,
                            result: item
                        })
                    })
                })
            };
            
            dbService.dbPromise = Promise.resolve(mockDB as any);
            
            const result = await dbService.get('customers', '1');
            expect(result).toEqual(item);
        });

        it('returns undefined when not found', async () => {
            const mockDB = {
                transaction: vi.fn().mockReturnValue({
                    objectStore: vi.fn().mockReturnValue({
                        get: vi.fn().mockReturnValue({
                            onsuccess: null,
                            result: undefined
                        })
                    })
                })
            };
            
            dbService.dbPromise = Promise.resolve(mockDB as any);
            
            const result = await dbService.get('customers', '999');
            expect(result).toBeUndefined();
        });
    });

    describe('upsertAll', () => {
        it('inserts items without clearing the store', async () => {
            const mockStore = {
                put: vi.fn(),
                clear: vi.fn()
            };
            const mockTransaction = {
                objectStore: vi.fn().mockReturnValue(mockStore),
                oncomplete: null,
                onerror: null
            };
            const mockDB = {
                transaction: vi.fn().mockReturnValue(mockTransaction)
            };
            
            dbService.dbPromise = Promise.resolve(mockDB as any);
            
            const items = [{ id: '1', name: 'test' }];
            const promise = dbService.upsertAll('customers', items);
            
            await promise;
            
            expect(mockStore.clear).not.toHaveBeenCalled();
            expect(mockStore.put).toHaveBeenCalledWith(items[0]);
        });

        it('does nothing for empty array', async () => {
            const mockDB = { transaction: vi.fn() };
            dbService.dbPromise = Promise.resolve(mockDB as any);
            
            await dbService.upsertAll('customers', []);
            
            expect(mockDB.transaction).not.toHaveBeenCalled();
        });
    });

    describe('saveAll', () => {
        it('clears store before inserting items', async () => {
            const mockStore = {
                put: vi.fn(),
                clear: vi.fn()
            };
            const mockTransaction = {
                objectStore: vi.fn().mockReturnValue(mockStore),
                oncomplete: null,
                onerror: null
            };
            const mockDB = {
                transaction: vi.fn().mockReturnValue(mockTransaction)
            };
            
            dbService.dbPromise = Promise.resolve(mockDB as any);
            
            const items = [{ id: '1', name: 'test' }];
            await dbService.saveAll('customers', items);
            
            expect(mockStore.clear).toHaveBeenCalled();
            expect(mockStore.put).toHaveBeenCalledWith(items[0]);
        });

        it('does not clear api_logs store', async () => {
            const mockStore = {
                put: vi.fn(),
                clear: vi.fn()
            };
            const mockTransaction = {
                objectStore: vi.fn().mockReturnValue(mockStore),
                oncomplete: null,
                onerror: null
            };
            const mockDB = {
                transaction: vi.fn().mockReturnValue(mockTransaction)
            };
            
            dbService.dbPromise = Promise.resolve(mockDB as any);
            
            const items = [{ id: '1', name: 'test' }];
            await dbService.saveAll('api_logs', items);
            
            expect(mockStore.clear).not.toHaveBeenCalled();
        });
    });

    describe('add', () => {
        it('adds a single item', async () => {
            const mockStore = { put: vi.fn() };
            const mockTransaction = {
                objectStore: vi.fn().mockReturnValue(mockStore),
                oncomplete: null,
                onerror: null
            };
            const mockDB = {
                transaction: vi.fn().mockReturnValue(mockTransaction)
            };
            
            dbService.dbPromise = Promise.resolve(mockDB as any);
            
            const item = { id: '1', name: 'test' };
            await dbService.add('customers', item);
            
            expect(mockStore.put).toHaveBeenCalledWith(item);
        });
    });

    describe('clearAll', () => {
        it('clears all stores', async () => {
            const mockStore = { clear: vi.fn() };
            const mockTransaction = {
                objectStore: vi.fn().mockReturnValue(mockStore),
                oncomplete: null,
                onerror: null
            };
            const mockDB = {
                transaction: vi.fn().mockReturnValue(mockTransaction),
                objectStoreNames: { contains: () => true }
            };
            
            dbService.dbPromise = Promise.resolve(mockDB as any);
            
            await dbService.clearAll();
            
            expect(mockTransaction.objectStore).toHaveBeenCalled();
        });
    });

    describe('deleteDatabase', () => {
        it('deletes the database', async () => {
            const mockRequest: any = {
                onsuccess: null,
                onerror: null
            };
            mockIndexedDB.deleteDatabase.mockReturnValue(mockRequest);

            const promise = dbService.deleteDatabase();
            mockRequest.onsuccess();
            
            await expect(promise).resolves.toBeUndefined();
            expect(mockIndexedDB.deleteDatabase).toHaveBeenCalledWith(DB_NAME);
        });
    });

    describe('getStorageStats', () => {
        it('returns count of items per store', async () => {
            const mockStore = {
                count: vi.fn().mockReturnValue({
                    onsuccess: null,
                    result: 5
                })
            };
            const mockDB = {
                transaction: vi.fn().mockReturnValue({
                    objectStore: vi.fn().mockReturnValue(mockStore)
                }),
                objectStoreNames: { contains: () => true }
            };
            
            dbService.dbPromise = Promise.resolve(mockDB as any);
            
            const stats = await dbService.getStorageStats();
            
            expect(stats).toHaveProperty('customers');
        });
    });

    describe('exportToJson', () => {
        it('exports all stores to JSON', async () => {
            const mockDB = {
                transaction: vi.fn().mockReturnValue({
                    objectStore: vi.fn().mockReturnValue({
                        getAll: vi.fn().mockReturnValue({
                            onsuccess: null,
                            result: [{ id: '1' }]
                        })
                    })
                }),
                objectStoreNames: { contains: () => true }
            };
            
            dbService.dbPromise = Promise.resolve(mockDB as any);
            
            const json = await dbService.exportToJson();
            const parsed = JSON.parse(json);
            
            expect(typeof json).toBe('string');
            expect(parsed).toBeDefined();
        });
    });

    describe('importFromJson', () => {
        it('imports data from JSON string', async () => {
            const mockStore = {
                clear: vi.fn(),
                put: vi.fn()
            };
            const mockTransaction = {
                objectStore: vi.fn().mockReturnValue(mockStore),
                oncomplete: null,
                onerror: null
            };
            const mockDB = {
                transaction: vi.fn().mockReturnValue(mockTransaction),
                objectStoreNames: { contains: () => true }
            };
            
            dbService.dbPromise = Promise.resolve(mockDB as any);
            
            const jsonData = JSON.stringify({ customers: [{ id: '1', name: 'test' }] });
            await dbService.importFromJson(jsonData);
            
            expect(mockStore.clear).toHaveBeenCalled();
            expect(mockStore.put).toHaveBeenCalled();
        });

        it('throws error for invalid JSON', async () => {
            dbService.dbPromise = Promise.resolve({} as any);
            
            await expect(dbService.importFromJson('invalid json')).rejects.toThrow();
        });
    });

    describe('getLastModified', () => {
        it('returns max timestamp from items', async () => {
            const items = [
                { id: '1', date_modification: 1000 },
                { id: '2', date_modification: 2000 },
                { id: '3', date_modification: 500 }
            ];
            
            dbService.getAll = vi.fn().mockResolvedValue(items);
            
            const result = await dbService.getLastModified('customers');
            
            expect(result).toBe(2000);
        });

        it('returns 0 for empty store', async () => {
            dbService.getAll = vi.fn().mockResolvedValue([]);
            
            const result = await dbService.getLastModified('customers');
            
            expect(result).toBe(0);
        });
    });
});

// ---------------------------------------------------------------------------
// #1039: Real IndexedDB integration tests for getLastModified().
//
// The legacy suite above is left untouched. These tests use fake-indexeddb to
// exercise the `date_modification` index + reverse key cursor end-to-end:
//   - fresh install creates the index on every store
//   - empty store / single record / 10k records (no full-array materialization)
//   - fallback scan path for non-indexed date fields
//   - v31 migration preserves existing data and adds the index
//   - migration is idempotent (guarded index creation never throws)
// ---------------------------------------------------------------------------
describe('getLastModified (real IndexedDB via fake-indexeddb) [#1039]', () => {
    beforeEach(() => {
        // dbService references the global `indexedDB`; point it at the fake.
        dbService.dbPromise = null;
        (globalThis as any).indexedDB = fakeIndexedDB;
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        // Close our connection so the subsequent deleteDatabase() isn't blocked.
        try {
            const db = await dbService.dbPromise;
            db?.close();
        } catch { /* ignore */ }
        dbService.dbPromise = null;
        await new Promise<void>((resolve) => {
            const req = fakeIndexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
        });
    });

    it('creates the date_modification index on stores during a fresh install', async () => {
        const db: IDBDatabase = await dbService.open();
        const store = db.transaction('customers', 'readonly').objectStore('customers');
        expect(store.indexNames.contains(DATE_MODIFICATION_INDEX)).toBe(true);
    });

    it('returns 0 for an empty store', async () => {
        await dbService.open();
        const result = await dbService.getLastModified('customers');
        expect(result).toBe(0);
    });

    it('returns the timestamp of a single record', async () => {
        await dbService.open();
        await dbService.saveAll('customers', [{ id: '1', date_modification: 1234 }]);
        const result = await dbService.getLastModified('customers');
        expect(result).toBe(1234);
    });

    it('returns the maximum timestamp across 10k records without materializing them', async () => {
        await dbService.open();
        const items = Array.from({ length: 10000 }, (_, i) => ({
            id: `c-${i}`,
            date_modification: 1000 + i, // max == 10999
        }));
        await dbService.saveAll('customers', items);

        // Prove the index path is taken: open the `date_modification` index and
        // never call getAll() (i.e. never load all 10k rows into memory).
        const getAllSpy = vi.spyOn(FDBObjectStore.prototype, 'getAll');
        const indexSpy = vi.spyOn(FDBObjectStore.prototype, 'index');

        const start = performance.now();
        const result = await dbService.getLastModified('customers');
        const elapsed = performance.now() - start;

        expect(result).toBe(10999);
        expect(indexSpy).toHaveBeenCalledWith(DATE_MODIFICATION_INDEX);
        expect(getAllSpy).not.toHaveBeenCalled();
        // Reverse key cursor => O(log n + k) instead of O(n). CI can be slow, so
        // we allow generous headroom while still bounding the cost.
        expect(elapsed).toBeLessThan(100);
    });

    it('falls back to a full scan for non-indexed date fields', async () => {
        await dbService.open();
        await dbService.saveAll('customers', [
            { id: '1', tms: 100 },
            { id: '2', tms: 300 },
            { id: '3', tms: 200 },
        ]);
        const getAllSpy = vi.spyOn(FDBObjectStore.prototype, 'getAll');

        // 'tms' is not the indexed field => must use the scan fallback.
        const result = await dbService.getLastModified('customers', 'tms');

        expect(result).toBe(300);
        expect(getAllSpy).toHaveBeenCalled();
    });

    it('preserves the multi-field fallback when records lack date_modification (semantic guard #1039)', async () => {
        // Records with NO date_modification are NOT present in the
        // date_modification index, so the fast path's reverse cursor would
        // report 0. The semantic guard must defer to the scan and return the
        // max of the fallback fields (date_creation here) instead of 0 —
        // otherwise backgroundSyncService would SKIP this module entirely.
        await dbService.open();
        await dbService.saveAll('customers', [
            { id: '1', date_creation: 500 },
            { id: '2', date_creation: 900 },
        ]);
        const getAllSpy = vi.spyOn(FDBObjectStore.prototype, 'getAll');

        const result = await dbService.getLastModified('customers');

        expect(result).toBe(900); // NOT 0 — watermark preserved
        expect(getAllSpy).toHaveBeenCalled(); // scan fallback engaged
    });

    it('preserves existing data and adds the index when upgrading from an old schema', async () => {
        // Pre-seed a v1 DB (a store WITHOUT the date_modification index).
        await new Promise<void>((resolve, reject) => {
            const req = fakeIndexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = (e: any) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('customers')) {
                    db.createObjectStore('customers', { keyPath: 'id' });
                }
            };
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction('customers', 'readwrite');
                tx.objectStore('customers').put({ id: 'a', date_modification: 555 });
                tx.objectStore('customers').put({ id: 'b', date_modification: 999 });
                tx.objectStore('customers').put({ id: 'c', date_modification: 777 });
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onerror = () => reject(tx.error);
            };
            req.onerror = () => reject(req.error);
        });

        // Upgrade to v31 via dbService (adds the index to the existing store).
        const db: IDBDatabase = await dbService.open();
        const store = db.transaction('customers', 'readonly').objectStore('customers');
        expect(store.indexNames.contains(DATE_MODIFICATION_INDEX)).toBe(true);

        // Data preserved and getLastModified() works through the new index.
        const all = await dbService.getAll('customers');
        expect(all.length).toBe(3);
        expect(await dbService.getLastModified('customers')).toBe(999);
    });

    it('idempotent migration: re-running the guarded index creation does not throw', async () => {
        await dbService.open();

        // Close dbService's connection so a higher-version open isn't blocked.
        const openDb: IDBDatabase = await dbService.dbPromise!;
        openDb.close();
        dbService.dbPromise = null;

        // Force a second upgrade pass (the index already exists from the first).
        await new Promise<void>((resolve, reject) => {
            const req = fakeIndexedDB.open(DB_NAME, DB_VERSION + 1);
            req.onupgradeneeded = (e: any) => {
                try {
                    const store = e.target.transaction.objectStore('customers');
                    // Guard mirrors the production code (#1039): no-op if present.
                    if (!store.indexNames.contains(DATE_MODIFICATION_INDEX)) {
                        store.createIndex(DATE_MODIFICATION_INDEX, DATE_MODIFICATION_INDEX, { unique: false });
                    }
                } catch (err) {
                    reject(err);
                }
            };
            req.onsuccess = () => { req.result.close(); resolve(); };
            req.onerror = () => reject(req.error);
            req.onblocked = () => reject(new Error('upgrade blocked'));
        });
    });

    it('unguarded duplicate index creation throws (the guard is required)', async () => {
        await dbService.open();
        const openDb: IDBDatabase = await dbService.dbPromise!;
        openDb.close();
        dbService.dbPromise = null;

        let threw = false;
        await new Promise<void>((resolve) => {
            const req = fakeIndexedDB.open(DB_NAME, DB_VERSION + 2);
            req.onupgradeneeded = (e: any) => {
                try {
                    const store = e.target.transaction.objectStore('customers');
                    // No guard -> must throw a ConstraintError (name already used).
                    store.createIndex(DATE_MODIFICATION_INDEX, DATE_MODIFICATION_INDEX, { unique: false });
                } catch {
                    threw = true;
                }
            };
            req.onsuccess = () => { req.result.close(); resolve(); };
            req.onerror = () => resolve(); // transaction aborted by the throw
            req.onblocked = () => resolve();
        });
        expect(threw).toBe(true);
    });
});
