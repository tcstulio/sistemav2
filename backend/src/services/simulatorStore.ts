import fs from 'fs';
import path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';
import { logger } from '../utils/logger';

const log = logger.child('SimulatorStore');

// --- Types ---

export interface SimulationSnapshot {
    id: string;
    name: string;
    date: number;
    data: unknown;
    summary: {
        revenue: number;
        profit: number;
        modelLabel: string;
    };
}

interface SimulatorStoreData {
    simulations: SimulationSnapshot[];
}

const STORE_PATH = path.join(__dirname, '../../data/simulations.json');

const DEFAULT_DATA: SimulatorStoreData = {
    simulations: []
};

class SimulatorStoreService {
    private data: SimulatorStoreData;

    constructor() {
        this.data = JSON.parse(JSON.stringify(DEFAULT_DATA));
        this.load();
    }

    private load() {
        try {
            const dir = path.dirname(STORE_PATH);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            if (fs.existsSync(STORE_PATH)) {
                const content = fs.readFileSync(STORE_PATH, 'utf-8');
                const parsed = JSON.parse(content);
                this.data = {
                    simulations: Array.isArray(parsed.simulations) ? parsed.simulations : []
                };
            }
        } catch (error) {
            log.error('Load Error', error);
        }
    }

    private save() {
        try {
            atomicWriteSync(STORE_PATH, this.data);
        } catch (error) {
            log.error('Save Error', error);
            throw error;
        }
    }

    // --- CRUD ---

    list(): SimulationSnapshot[] {
        return [...this.data.simulations];
    }

    getById(id: string): SimulationSnapshot | undefined {
        return this.data.simulations.find(s => s.id === id);
    }

    create(snapshot: SimulationSnapshot): SimulationSnapshot {
        this.data.simulations = [snapshot, ...this.data.simulations];
        this.save();
        log.info(`Created simulation snapshot id=${snapshot.id} name="${snapshot.name}"`);
        return snapshot;
    }

    update(id: string, updates: Partial<Pick<SimulationSnapshot, 'name' | 'date' | 'data' | 'summary'>>): SimulationSnapshot | null {
        const idx = this.data.simulations.findIndex(s => s.id === id);
        if (idx === -1) return null;

        const updated: SimulationSnapshot = {
            ...this.data.simulations[idx],
            ...updates,
        };
        this.data.simulations = [
            ...this.data.simulations.slice(0, idx),
            updated,
            ...this.data.simulations.slice(idx + 1),
        ];
        this.save();
        log.info(`Updated simulation snapshot id=${id}`);
        return updated;
    }

    delete(id: string): boolean {
        const before = this.data.simulations.length;
        this.data.simulations = this.data.simulations.filter(s => s.id !== id);
        const deleted = this.data.simulations.length < before;
        if (deleted) {
            this.save();
            log.info(`Deleted simulation snapshot id=${id}`);
        }
        return deleted;
    }
}

export const simulatorStore = new SimulatorStoreService();
