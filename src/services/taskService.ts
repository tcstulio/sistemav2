import axios from 'axios';
import { logger } from '../utils/logger';
import { safeStorage } from '../utils/safeStorage';

const log = logger.child('TaskService');

const API_URL = '/api/tasks';

const getAuthHeaders = () => {
    const savedConfigObj = safeStorage.getJSON<Record<string, any>>('coolgroove_config', {});
    const token = savedConfigObj.apiKey || '';
    return { headers: { 'Authorization': 'Bearer ' + token } };
};

export interface Task {
    issueNumber: number;
    title: string;
    body: string;
    labels: string[];
    status: 'pending' | 'running' | 'reviewing' | 'approved' | 'fixing' | 'merged' | 'rejected' | 'failed';
    branch?: string;
    prNumber?: number;
    prUrl?: string;
    judgeScore?: number;
    judgeReview?: string;
    judgeAttempts?: number;
    feedbackHistory: string[];
    startedAt?: string;
    updatedAt: string;
    completedAt?: string;
    error?: string;
}

export const TaskService = {
    list: async (): Promise<Task[]> => {
        const response = await axios.get(API_URL, getAuthHeaders());
        return response.data;
    },

    get: async (issueNumber: number): Promise<Task> => {
        const response = await axios.get(`${API_URL}/${issueNumber}`, getAuthHeaders());
        return response.data;
    },

    getDiff: async (issueNumber: number): Promise<string> => {
        const response = await axios.get(`${API_URL}/${issueNumber}/diff`, getAuthHeaders());
        return response.data.diff;
    },

    start: async (issueNumber: number): Promise<Task> => {
        const response = await axios.post(`${API_URL}/${issueNumber}/start`, {}, getAuthHeaders());
        return response.data;
    },

    fix: async (issueNumber: number, feedback: string): Promise<Task> => {
        const response = await axios.post(`${API_URL}/${issueNumber}/fix`, { feedback }, getAuthHeaders());
        return response.data;
    },

    redo: async (issueNumber: number, instruction?: string): Promise<Task> => {
        const response = await axios.post(`${API_URL}/${issueNumber}/redo`, { instruction }, getAuthHeaders());
        return response.data;
    },

    reject: async (issueNumber: number): Promise<Task> => {
        const response = await axios.post(`${API_URL}/${issueNumber}/reject`, {}, getAuthHeaders());
        return response.data;
    },

    merge: async (issueNumber: number): Promise<Task> => {
        const response = await axios.post(`${API_URL}/${issueNumber}/merge`, {}, getAuthHeaders());
        return response.data;
    },

    update: async (issueNumber: number, data: Partial<Pick<Task, 'title' | 'body' | 'labels'>>): Promise<Task> => {
        const response = await axios.put(`${API_URL}/${issueNumber}`, data, getAuthHeaders());
        return response.data;
    },

    delete: async (issueNumber: number): Promise<void> => {
        await axios.delete(`${API_URL}/${issueNumber}`, getAuthHeaders());
    },
};
