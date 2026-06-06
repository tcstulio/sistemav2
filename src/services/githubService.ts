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
    getIssues: async (params?: { state?: string; label?: string; limit?: number }): Promise<GitHubIssue[]> => {
        try {
            const q = new URLSearchParams();
            if (params?.state) q.set('state', params.state);
            if (params?.label) q.set('label', params.label);
            if (params?.limit) q.set('limit', String(params.limit));
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
    }
};
