import { config as AppConfig } from '../config';
import { SimulationSnapshot } from '../pages/Simulator/components/modals/SavedSimulationsModal';

const BASE = () => `${AppConfig.API_BASE_URL}/api/simulator`;

async function handleResponse<T>(res: Response): Promise<T> {
    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
            const body = await res.json();
            msg = body?.error || JSON.stringify(body) || msg;
        } catch {
            const text = await res.text();
            if (text) msg = text;
        }
        throw new Error(msg);
    }
    if (res.status === 204) return undefined as unknown as T;
    return res.json();
}

export const simulatorApi = {
    async list(): Promise<SimulationSnapshot[]> {
        const res = await fetch(`${BASE()}/simulations`, { credentials: 'include' });
        return handleResponse<SimulationSnapshot[]>(res);
    },

    async create(snapshot: SimulationSnapshot): Promise<SimulationSnapshot> {
        const res = await fetch(`${BASE()}/simulations`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(snapshot),
        });
        return handleResponse<SimulationSnapshot>(res);
    },

    async update(id: string, updates: Partial<Pick<SimulationSnapshot, 'name' | 'date' | 'data' | 'summary'>>): Promise<SimulationSnapshot> {
        const res = await fetch(`${BASE()}/simulations/${encodeURIComponent(id)}`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        });
        return handleResponse<SimulationSnapshot>(res);
    },

    async delete(id: string): Promise<void> {
        const res = await fetch(`${BASE()}/simulations/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            credentials: 'include',
        });
        return handleResponse<void>(res);
    },
};
