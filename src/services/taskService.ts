import axios from 'axios';
import { logger } from '../utils/logger';
import { safeStorage } from '../utils/safeStorage';

const log = logger.child('TaskService');

const API_URL = '/api/tasks';

const getAuthHeaders = () => {
    const savedConfigObj = safeStorage.getJSON<Record<string, any>>('coolgroove_config', {});
    const token = savedConfigObj.apiKey || '';
    // timeout p/ não pendurar a UI silenciosamente se o backend travar (ex.: verificação de
    // admin via Dolibarr lenta/sem resposta). Sem isso, um delete que falha fica "mudo". (#323)
    return { headers: { 'Authorization': 'Bearer ' + token }, timeout: 30000 };
};

export type TaskPhase = 'exploring' | 'synthesizing' | 'judging' | 'done';

export interface AttemptResult {
    index: number;
    phase: TaskPhase;
    diff: string;
    typecheckOk: boolean;
    typecheckErrors?: string;
    filesChanged: string[];
    summary?: string;
}

export interface SubTaskPlan {
    title: string;
    body: string;
    filesEstimate: string[];
    dependsOn: number[];
    complexity: 'low' | 'medium' | 'high';
}

export interface DecompositionPlan {
    subTasks: SubTaskPlan[];
    createdAt: string;
    approvedAt?: string;
}

export interface Task {
    issueNumber: number;
    title: string;
    body: string;
    labels: string[];
    status: 'pending' | 'running' | 'reviewing' | 'approved' | 'fixing' | 'cancelling' | 'cancelled' | 'merged' | 'rejected' | 'failed';
    branch?: string;
    prNumber?: number;
    prUrl?: string;
    judgeScore?: number;
    judgeReview?: string;
    judgeAttempts?: number;
    visualScore?: number;
    visualReview?: string;
    feedbackHistory: string[];
    startedAt?: string;
    arrivedAt?: string;
    updatedAt: string;
    completedAt?: string;
    error?: string;
    events?: TaskEvent[];
    childPid?: number;
    killRequested?: boolean;
    killedAt?: string;
    queuePriority?: number;
    planReason?: string;
    phase?: TaskPhase;
    attempts?: AttemptResult[];
    synthesisAttempt?: number;
    kind?: 'task' | 'epic';
    subTasks?: number[];
    decompositionPlan?: DecompositionPlan;
    parentEpic?: number;
}

export interface TaskEvent {
    ts: string;
    type: string;
    message: string;
    meta?: Record<string, any>;
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

    create: async (title: string, body: string, labels?: string[]): Promise<Task> => {
        const response = await axios.post(API_URL, { title, body, labels }, getAuthHeaders());
        return response.data;
    },

    getDiff: async (issueNumber: number): Promise<string> => {
        const response = await axios.get(`${API_URL}/${issueNumber}/diff`, getAuthHeaders());
        return response.data.diff;
    },

    listEvents: async (issueNumber: number): Promise<TaskEvent[]> => {
        const response = await axios.get(`${API_URL}/${issueNumber}/events`, getAuthHeaders());
        return response.data.events;
    },

    getScreenshots: async (issueNumber: number): Promise<{ before: string | null; after: string | null }> => {
        try {
            const response = await axios.get(`${API_URL}/${issueNumber}/screenshots`, getAuthHeaders());
            return response.data;
        } catch {
            return { before: null, after: null };
        }
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

    kill: async (issueNumber: number, reason?: string): Promise<Task> => {
        const response = await axios.post(`${API_URL}/${issueNumber}/kill`, { reason: reason || 'admin request' }, getAuthHeaders());
        return response.data;
    },

    update: async (issueNumber: number, data: Partial<Pick<Task, 'title' | 'body' | 'labels'>>): Promise<Task> => {
        const response = await axios.put(`${API_URL}/${issueNumber}`, data, getAuthHeaders());
        return response.data;
    },

    delete: async (issueNumber: number): Promise<void> => {
        await axios.delete(`${API_URL}/${issueNumber}`, getAuthHeaders());
    },

    plan: async (): Promise<{ order: number[]; reasons: Record<number, string> }> => {
        const response = await axios.post(`${API_URL}/plan`, {}, getAuthHeaders());
        return response.data;
    },

    reorder: async (order: number[]): Promise<void> => {
        await axios.put(`${API_URL}/reorder`, { order }, getAuthHeaders());
    },

    analyze: async (issueNumber: number): Promise<{
        action: string; reason: string; priority: number;
        blockedBy: number[]; overlappingFiles: string[];
        alreadyResolved: boolean; filesEstimate: string[];
    }> => {
        const response = await axios.post(`${API_URL}/planner/analyze/${issueNumber}`, {}, getAuthHeaders());
        return response.data;
    },

    reevaluate: async (): Promise<{ reevaluated: number; decisions: any[] }> => {
        const response = await axios.post(`${API_URL}/planner/reevaluate`, {}, getAuthHeaders());
        return response.data;
    },

    startPreview: async (issueNumber: number): Promise<{ port: number; frontendUrl: string; backendUrl: string }> => {
        const response = await axios.post(`${API_URL}/${issueNumber}/preview`, {}, getAuthHeaders());
        return response.data;
    },

    stopPreview: async (issueNumber: number): Promise<void> => {
        await axios.delete(`${API_URL}/${issueNumber}/preview`, getAuthHeaders());
    },

    markAsEpic: async (issueNumber: number): Promise<Task> => {
        const response = await axios.post(`${API_URL}/${issueNumber}/mark-epic`, {}, getAuthHeaders());
        return response.data;
    },

    decomposeEpic: async (issueNumber: number): Promise<Task> => {
        const response = await axios.post(`${API_URL}/${issueNumber}/decompose`, {}, getAuthHeaders());
        return response.data;
    },

    approveDecomposition: async (issueNumber: number): Promise<Task> => {
        const response = await axios.post(`${API_URL}/${issueNumber}/approve-decomposition`, {}, getAuthHeaders());
        return response.data;
    },
};
