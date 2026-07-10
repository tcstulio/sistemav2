import axios from 'axios';
import { safeStorage } from '../utils/safeStorage';
import { logger } from '../utils/logger';

const log = logger.child('GithubService');

const getAuthHeaders = () => {
    const savedConfigObj = safeStorage.getJSON<Record<string, any>>('coolgroove_config', {});
    const token = savedConfigObj.apiKey || '';
    return { headers: { 'Authorization': 'Bearer ' + token } };
};

export interface GitHubIssue {
    number: number;
    title: string;
    state: string;
    labels: Array<{ name: string; color: string }>;
    createdAt: string;
    closedAt?: string;
    url: string;
    assignees: Array<{ login: string }>;
}

export interface IssueStats {
    totalOpen: number;
    totalClosed: number;
    byLabel: Record<string, { open: number; closed: number }>;
    recentClosed: GitHubIssue[];
}

export const GithubService = {
    getIssues: async (params?: { state?: string; label?: string; limit?: number; period?: string }): Promise<GitHubIssue[]> => {
        try {
            const q = new URLSearchParams();
            if (params?.state) q.set('state', params.state);
            if (params?.label) q.set('label', params.label);
            if (params?.limit) q.set('limit', String(params.limit));
            if (params?.period) q.set('period', params.period);
            const qs = q.toString();
            const url = `/api/github/issues${qs ? '?' + qs : ''}`;
            const res = await axios.get(url, getAuthHeaders());
            return res.data.data || [];
        } catch (e: any) {
            log.error('Failed to fetch issues', e);
            return [];
        }
    },

    getStats: async (): Promise<IssueStats | null> => {
        try {
            const res = await axios.get('/api/github/issues/stats', getAuthHeaders());
            return res.data;
        } catch (e: any) {
            log.error('Failed to fetch issue stats', e);
            return null;
        }
    },

    // Fecha/reabre uma issue (gestão in-app). reason='not planned' p/ duplicadas/wontfix.
    setIssueState: async (issueNumber: number, state: 'open' | 'closed', reason?: string): Promise<{ ok: boolean; error?: string }> => {
        try {
            const res = await axios.post(`/api/github/issues/${issueNumber}/state`, { state, reason }, getAuthHeaders());
            return res.data;
        } catch (e: any) {
            const error = e?.response?.data?.error || e?.message || 'Falha ao alterar estado da issue';
            log.error('Failed to set issue state', e);
            return { ok: false, error };
        }
    },

    // Adiciona um label a uma issue (#315 "Virar Task" → opencode-task).
    addLabel: async (issueNumber: number, label: string): Promise<{ ok: boolean; error?: string }> => {
        try {
            const res = await axios.post(`/api/github/issues/${issueNumber}/labels`, { label }, getAuthHeaders());
            return res.data;
        } catch (e: any) {
            const error = e?.response?.data?.error || e?.message || 'Falha ao adicionar label';
            log.error('Failed to add label', e);
            return { ok: false, error };
        }
    },

    // Cria uma issue no GitHub a partir de um report in-app (botão "Reportar problema").
    createIssue: async (payload: { title: string; description?: string; context?: any; labels?: string[] }): Promise<{ ok: boolean; url?: string; number?: number; error?: string }> => {
        try {
            const res = await axios.post('/api/github/issues', payload, getAuthHeaders());
            return res.data;
        } catch (e: any) {
            const error = e?.response?.data?.error || e?.message || 'Falha ao criar issue';
            log.error('Failed to create issue', e);
            return { ok: false, error };
        }
    }
};
