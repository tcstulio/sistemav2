import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../utils/logger';
import { atomicWriteSync } from '../utils/atomicWrite';

const log = createLogger('AdminAudit');

/** Uma entrada do trilho de auditoria de ações administrativas. */
export interface AdminAuditEntry {
    id: string;
    ts: number;
    adminId: string;
    adminLogin: string;
    action: string;       // ex.: 'user.permissions.update', 'ui-config.update'
    target?: string;      // alvo da ação (ex.: userId)
    summary?: string;     // descrição curta legível
    changes?: Record<string, { before: unknown; after: unknown }>;
}

interface AuditStore {
    entries: AdminAuditEntry[];
}

const STORE_PATH = path.join(__dirname, '../../data/admin_audit.json');
const MAX_ENTRIES = 2000;

class AdminAuditService {
    private data: AuditStore = { entries: [] };

    constructor() {
        this.load();
    }

    private load() {
        try {
            const dir = path.dirname(STORE_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (fs.existsSync(STORE_PATH)) {
                this.data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
            }
            log.info(`Loaded ${this.data.entries.length} admin audit entries`);
        } catch (e) {
            log.error('Load error', e);
            this.data = { entries: [] };
        }
    }

    private save() {
        try {
            const dir = path.dirname(STORE_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            atomicWriteSync(STORE_PATH, this.data);
        } catch (e) {
            log.error('Save error', e);
        }
    }

    /** Registra uma ação administrativa. Nunca lança (auditoria não deve quebrar a operação). */
    record(entry: Omit<AdminAuditEntry, 'id' | 'ts'>): AdminAuditEntry | null {
        try {
            const e: AdminAuditEntry = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                ts: Date.now(),
                ...entry,
            };
            this.data.entries.unshift(e);
            if (this.data.entries.length > MAX_ENTRIES) {
                this.data.entries.length = MAX_ENTRIES;
            }
            this.save();
            return e;
        } catch (err) {
            log.error('record error', err);
            return null;
        }
    }

    /** Lista entradas (mais recentes primeiro), com filtros opcionais. */
    list(opts: { limit?: number; action?: string; target?: string } = {}): AdminAuditEntry[] {
        let entries = this.data.entries;
        if (opts.action) entries = entries.filter((e) => e.action === opts.action);
        if (opts.target) entries = entries.filter((e) => e.target === opts.target);
        const limit = Math.min(Math.max(opts.limit ?? 100, 1), MAX_ENTRIES);
        return entries.slice(0, limit);
    }
}

export const adminAuditService = new AdminAuditService();
