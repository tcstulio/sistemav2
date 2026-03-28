/**
 * Tulipa Service
 *
 * Comunicação com o Tulipa Server para Brain Hub, Tasks e Orquestração.
 *
 * @see docs/MOLTBOT_INTEGRATION_PLAN.md
 */

import http from 'http';

// Configuration
interface TulipaConfig {
    host: string;
    port: number;
    timeout: number;
}

const DEFAULT_CONFIG: TulipaConfig = {
    host: process.env.TULIPA_HOST || 'localhost',
    port: parseInt(process.env.TULIPA_PORT || '8081', 10),
    timeout: parseInt(process.env.TULIPA_TIMEOUT || '10000', 10),
};

// Types
export interface BrainPerson {
    id: string;
    name: string;
    phone?: string;
    email?: string;
    firstSeen: string;
    lastSeen: string;
    messageCount: number;
    channels: string[];
    tags?: string[];
    notes?: string;
    linkedCustomerId?: string;
}

export interface BrainEvent {
    id: string;
    timestamp: string;
    source: 'whatsapp' | 'email' | 'telegram' | 'sms';
    sender: string;
    senderName?: string;
    content: string;
    mediaType: 'text' | 'image' | 'audio' | 'video' | 'document';
    chatId: string;
    threadId?: string;
    isGroup: boolean;
    groupName?: string;
    messageId?: string;
}

export interface EventStats {
    totalEvents: number;
    eventsToday: number;
    eventsThisWeek: number;
    uniqueSenders: number;
    byChannel: Record<string, number>;
    byMediaType: Record<string, number>;
}

export interface Task {
    id: string;
    name: string;
    description?: string;
    type?: string;
    status: 'pending' | 'ready' | 'claimed' | 'running' | 'completed' | 'failed' | 'blocked';
    priority: 'low' | 'medium' | 'high' | 'critical';
    projectId?: string;
    parentId?: string;
    dependencies?: string[];
    claimedBy?: string;
    claimedAt?: number;
    output?: any;
    error?: string;
    createdAt: number;
    updatedAt?: number;
    completedAt?: number;
    dueDate?: number;
}

export interface Project {
    id: string;
    name: string;
    description?: string;
    status: 'active' | 'paused' | 'archived' | 'completed';
    metadata?: Record<string, any>;
    createdAt: number;
    updatedAt: number;
}

export interface SystemStatus {
    healthy: boolean;
    uptime: number;
    database: { connected: boolean };
    gateway: { healthy: boolean; whatsapp?: { connected: boolean } };
    executor: { enabled: boolean; running: boolean };
    stats: {
        tasks: { total: number; pending: number; completed: number };
        agents: { total: number; active: number };
        brain: { people: number; eventsToday: number };
    };
}

export interface WhatsAppStatus {
    connected: boolean;
    status: string;
    phone: string | null;
    checkedAt: number;
    error?: string;
}

/**
 * Tulipa Service Client
 */
class TulipaService {
    private config: TulipaConfig;

    constructor(config?: Partial<TulipaConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Low-level API call to Tulipa Server
     */
    private async callAPI<T = any>(
        path: string,
        method: string = 'GET',
        body?: any
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            const options: http.RequestOptions = {
                hostname: this.config.host,
                port: this.config.port,
                path: `/api${path}`,
                method,
                timeout: this.config.timeout,
                headers: {
                    'Content-Type': 'application/json',
                }
            };

            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        resolve(json as T);
                    } catch (e) {
                        reject(new Error(`JSON parse failed: ${data.substring(0, 100)}`));
                    }
                });
            });

            req.on('error', (err) => {
                reject(new Error(`Tulipa connection failed: ${err.message}`));
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Tulipa request timeout'));
            });

            if (body) {
                req.write(JSON.stringify(body));
            }
            req.end();
        });
    }

    /**
     * Check if Tulipa integration is enabled
     */
    isEnabled(): boolean {
        return process.env.TULIPA_ENABLED === 'true';
    }

    // ========================================
    // SYSTEM STATUS
    // ========================================

    /**
     * Get full system status
     */
    async getSystemStatus(): Promise<SystemStatus | null> {
        try {
            return await this.callAPI<SystemStatus>('/status');
        } catch (error) {
            console.error('[TulipaService] Failed to get system status:', error);
            return null;
        }
    }

    /**
     * Get quick health check
     */
    async getQuickStatus(): Promise<{ healthy: boolean; message?: string }> {
        try {
            const result = await this.callAPI<any>('/status/quick');
            return { healthy: result.healthy || result.ok, message: result.message };
        } catch (error: any) {
            return { healthy: false, message: error.message };
        }
    }

    /**
     * Get WhatsApp status (via Tulipa proxy)
     */
    async getWhatsAppStatus(): Promise<WhatsAppStatus> {
        try {
            return await this.callAPI<WhatsAppStatus>('/whatsapp/status');
        } catch (error: any) {
            return {
                connected: false,
                status: 'error',
                phone: null,
                checkedAt: Date.now(),
                error: error.message
            };
        }
    }

    // ========================================
    // BRAIN HUB - PEOPLE
    // ========================================

    /**
     * Get all people from Brain Hub
     */
    async getPeople(): Promise<BrainPerson[]> {
        try {
            const result = await this.callAPI<any>('/brain/people');
            return result.data || result.people || result || [];
        } catch (error) {
            console.error('[TulipaService] Failed to get people:', error);
            return [];
        }
    }

    /**
     * Get a specific person
     */
    async getPerson(id: string): Promise<BrainPerson | null> {
        try {
            const result = await this.callAPI<any>(`/brain/people/${encodeURIComponent(id)}`);
            return result.data || result;
        } catch (error) {
            return null;
        }
    }

    /**
     * Update a person's data
     */
    async updatePerson(id: string, data: Partial<BrainPerson>): Promise<boolean> {
        try {
            await this.callAPI<any>(`/brain/people/${encodeURIComponent(id)}`, 'PUT', data);
            return true;
        } catch (error) {
            console.error('[TulipaService] Failed to update person:', error);
            return false;
        }
    }

    /**
     * Link a Brain person to a Dolibarr customer
     */
    async linkPersonToCustomer(personId: string, customerId: string): Promise<boolean> {
        try {
            await this.callAPI<any>(`/brain/people/${encodeURIComponent(personId)}/link`, 'POST', {
                customerId
            });
            return true;
        } catch (error) {
            console.error('[TulipaService] Failed to link person to customer:', error);
            return false;
        }
    }

    // ========================================
    // BRAIN HUB - EVENTS
    // ========================================

    /**
     * Get events from Brain Hub
     */
    async getEvents(date?: string): Promise<BrainEvent[]> {
        try {
            const query = date ? `?date=${date}` : '';
            const result = await this.callAPI<any>(`/brain/events${query}`);
            return result.data || result.events || result || [];
        } catch (error) {
            console.error('[TulipaService] Failed to get events:', error);
            return [];
        }
    }

    /**
     * Get events by person
     */
    async getEventsByPerson(personId: string, limit: number = 50): Promise<BrainEvent[]> {
        try {
            const result = await this.callAPI<any>(`/brain/events?sender=${encodeURIComponent(personId)}&limit=${limit}`);
            return result.data || result.events || result || [];
        } catch (error) {
            console.error('[TulipaService] Failed to get events by person:', error);
            return [];
        }
    }

    /**
     * Get event statistics
     */
    async getEventsStats(): Promise<EventStats | null> {
        try {
            return await this.callAPI<EventStats>('/brain/events/stats');
        } catch (error) {
            console.error('[TulipaService] Failed to get events stats:', error);
            return null;
        }
    }

    /**
     * Get brain summary
     */
    async getBrainSummary(): Promise<any> {
        try {
            return await this.callAPI<any>('/brain/summary');
        } catch (error) {
            console.error('[TulipaService] Failed to get brain summary:', error);
            return null;
        }
    }

    // ========================================
    // TASKS
    // ========================================

    /**
     * Get all tasks
     */
    async getTasks(projectId?: string): Promise<Task[]> {
        try {
            const query = projectId ? `?projectId=${projectId}` : '';
            const result = await this.callAPI<any>(`/tasks${query}`);
            return result.data || result.tasks || result || [];
        } catch (error) {
            console.error('[TulipaService] Failed to get tasks:', error);
            return [];
        }
    }

    /**
     * Get available tasks (ready to claim)
     */
    async getAvailableTasks(): Promise<Task[]> {
        try {
            const result = await this.callAPI<any>('/tasks/available');
            return result.data || result.tasks || result || [];
        } catch (error) {
            console.error('[TulipaService] Failed to get available tasks:', error);
            return [];
        }
    }

    /**
     * Get a specific task
     */
    async getTask(id: string): Promise<Task | null> {
        try {
            const result = await this.callAPI<any>(`/tasks/${id}`);
            return result.data || result;
        } catch (error) {
            return null;
        }
    }

    /**
     * Create a new task
     */
    async createTask(task: Partial<Task>): Promise<Task | null> {
        try {
            const result = await this.callAPI<any>('/tasks', 'POST', task);
            return result.data || result;
        } catch (error) {
            console.error('[TulipaService] Failed to create task:', error);
            return null;
        }
    }

    /**
     * Claim a task
     */
    async claimTask(taskId: string, agentId: string): Promise<boolean> {
        try {
            await this.callAPI<any>(`/tasks/${taskId}/claim`, 'POST', { sessionId: agentId });
            return true;
        } catch (error) {
            console.error('[TulipaService] Failed to claim task:', error);
            return false;
        }
    }

    /**
     * Complete a task
     */
    async completeTask(taskId: string, output: any): Promise<boolean> {
        try {
            await this.callAPI<any>(`/tasks/${taskId}/complete`, 'POST', { output });
            return true;
        } catch (error) {
            console.error('[TulipaService] Failed to complete task:', error);
            return false;
        }
    }

    /**
     * Fail a task
     */
    async failTask(taskId: string, error: string): Promise<boolean> {
        try {
            await this.callAPI<any>(`/tasks/${taskId}/fail`, 'POST', { error });
            return true;
        } catch (error) {
            console.error('[TulipaService] Failed to fail task:', error);
            return false;
        }
    }

    // ========================================
    // PROJECTS
    // ========================================

    /**
     * Get all projects
     */
    async getProjects(): Promise<Project[]> {
        try {
            const result = await this.callAPI<any>('/projects');
            return result.data || result.projects || result || [];
        } catch (error) {
            console.error('[TulipaService] Failed to get projects:', error);
            return [];
        }
    }

    /**
     * Create a new project
     */
    async createProject(project: Partial<Project>): Promise<Project | null> {
        try {
            const result = await this.callAPI<any>('/projects', 'POST', project);
            return result.data || result;
        } catch (error) {
            console.error('[TulipaService] Failed to create project:', error);
            return null;
        }
    }

    // ========================================
    // AGENTS
    // ========================================

    /**
     * Register an agent
     */
    async registerAgent(agentData: {
        sessionId: string;
        agentType?: string;
        capabilities?: string[];
        model?: string;
    }): Promise<boolean> {
        try {
            await this.callAPI<any>('/agents/register', 'POST', agentData);
            return true;
        } catch (error) {
            console.error('[TulipaService] Failed to register agent:', error);
            return false;
        }
    }

    /**
     * Send agent heartbeat
     */
    async agentHeartbeat(sessionId: string): Promise<boolean> {
        try {
            await this.callAPI<any>('/agents/heartbeat', 'POST', { sessionId });
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get active agents
     */
    async getActiveAgents(): Promise<any[]> {
        try {
            const result = await this.callAPI<any>('/agents/active');
            return result.data || result.agents || result || [];
        } catch (error) {
            console.error('[TulipaService] Failed to get active agents:', error);
            return [];
        }
    }

    // ========================================
    // SYNC
    // ========================================

    /**
     * Trigger brain sync
     */
    async triggerBrainSync(): Promise<boolean> {
        try {
            await this.callAPI<any>('/brain/sync', 'POST');
            return true;
        } catch (error) {
            console.error('[TulipaService] Failed to trigger brain sync:', error);
            return false;
        }
    }
}

// Singleton instance
export const tulipaService = new TulipaService();

// Export class for custom instances
export { TulipaService };
