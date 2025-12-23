import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { WhatsAppService } from '../services/whatsappService';

interface ScheduledMessage {
    id: string;
    chatId: string;
    sessionId: string;
    message: string;
    scheduledAt: number;
    type: string;
    status: string;
    createdAt: number;
    sentAt?: number;
    error?: string;
}

interface Template {
    id: string;
    name: string;
    content: string;
    category: string;
}

interface ChatFlow {
    id: string;
    name: string;
    triggerKeywords: string[];
    enabled: boolean;
    steps: any[];
    sessionId?: string;
}

interface AutomationRule {
    id: string;
    name: string;
    event: string;
    enabled: boolean;
    message?: string;
    templateId?: string;
    sessionId: string;
    delay?: number;
}

interface MessageLog {
    id: string;
    messageId: string;
    chatId: string;
    sessionId: string;
    type: string;
    status: string;
    message: string;
    error?: string;
    createdAt: number;
    sentAt?: number;
}

interface WhatsAppSession {
    id: string;
    name?: string;
    status: string;
}

interface Stats {
    pending: number;
    sent: number;
    failed: number;
    templates: number;
    automationRules: number;
    activeRules: number;
    chatFlows: number;
    logsSentToday: number;
    logsFailedToday: number;
}

// API Base URL
import { config } from '../config';
const API_BASE = config.API_BASE_URL;

// Available events for automation
const AVAILABLE_EVENTS = [
    { value: 'invoice_created', label: 'Fatura Criada' },
    { value: 'invoice_paid', label: 'Fatura Paga' },
    { value: 'invoice_overdue', label: 'Fatura Vencida' },
    { value: 'ticket_created', label: 'Chamado Aberto' },
    { value: 'ticket_closed', label: 'Chamado Fechado' },
    { value: 'ticket_updated', label: 'Chamado Atualizado' },
    { value: 'order_created', label: 'Pedido Criado' },
    { value: 'custom', label: 'Evento Customizado' }
];

export const SchedulerAdmin: React.FC = () => {
    const [stats, setStats] = useState<Stats | null>(null);
    const [pending, setPending] = useState<ScheduledMessage[]>([]);
    const [templates, setTemplates] = useState<Template[]>([]);
    const [flows, setFlows] = useState<ChatFlow[]>([]);
    const [rules, setRules] = useState<AutomationRule[]>([]);
    const [logs, setLogs] = useState<MessageLog[]>([]);
    const [activeTab, setActiveTab] = useState<'pending' | 'rules' | 'templates' | 'flows' | 'schedule' | 'logs' | 'broadcast'>('rules');
    const [isLoading, setIsLoading] = useState(true);

    // WhatsApp sessions for multi-account support
    const [sessions, setSessions] = useState<WhatsAppSession[]>([]);
    const [selectedSessionId, setSelectedSessionId] = useState<string>('default');

    // Modal states
    const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
    const [showNewRuleForm, setShowNewRuleForm] = useState(false);
    const [showNewFlowForm, setShowNewFlowForm] = useState(false);

    // New message form
    const [newMessage, setNewMessage] = useState({ chatId: '', message: '', scheduledAt: '' });

    // New template form
    const [newTemplate, setNewTemplate] = useState({ name: '', content: '', category: 'general' });

    // New rule form - sessionId will use selectedSessionId
    const [newRule, setNewRule] = useState({ name: '', event: 'invoice_created', message: '', delay: 0 });

    // New flow form - sessionId will use selectedSessionId
    const [newFlow, setNewFlow] = useState({ name: '', triggerKeywords: '' });

    // Broadcast form
    const [broadcast, setBroadcast] = useState({ csvContent: '', message: '', delayBetween: 3 });

    // Variables per event type
    const [eventVariables, setEventVariables] = useState<Record<string, string[]>>({});

    // Test result modal
    const [testResult, setTestResult] = useState<any>(null);

    // Broadcasts list
    const [broadcasts, setBroadcasts] = useState<any[]>([]);
    const [selectedBroadcast, setSelectedBroadcast] = useState<any>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            // Fetch WhatsApp sessions first
            try {
                const sessionsData = await WhatsAppService.getAccounts();
                setSessions(sessionsData || []);
                // Set default session if not already set
                if (sessionsData.length > 0 && selectedSessionId === 'default') {
                    const connectedSession = sessionsData.find((s: WhatsAppSession) => s.status === 'CONNECTED');
                    if (connectedSession) {
                        setSelectedSessionId(connectedSession.id);
                    }
                }
            } catch (e) {
                console.warn('Failed to fetch WhatsApp sessions');
            }

            const [statsRes, pendingRes, templatesRes, flowsRes, rulesRes, logsRes] = await Promise.all([
                fetch(`${API_BASE}/api/scheduler/stats`),
                fetch(`${API_BASE}/api/scheduler/pending`),
                fetch(`${API_BASE}/api/scheduler/templates`),
                fetch(`${API_BASE}/api/webhook/flows`),
                fetch(`${API_BASE}/api/webhook/rules`),
                fetch(`${API_BASE}/api/webhook/logs?limit=100`)
            ]);

            if (statsRes.ok) setStats(await statsRes.json());
            if (pendingRes.ok) {
                const data = await pendingRes.json();
                setPending(data.data || []);
            }
            if (templatesRes.ok) {
                const data = await templatesRes.json();
                setTemplates(data.data || []);
            }
            if (flowsRes.ok) {
                const data = await flowsRes.json();
                setFlows(data.data || []);
            }
            if (rulesRes.ok) {
                const data = await rulesRes.json();
                setRules(data.data || []);
            }
            if (logsRes.ok) {
                const data = await logsRes.json();
                setLogs(data.data || []);
            }

            // Fetch event variables
            try {
                const varsRes = await fetch(`${API_BASE}/api/webhook/variables`);
                if (varsRes.ok) setEventVariables(await varsRes.json());
            } catch (e) { }

            // Fetch broadcasts
            try {
                const broadcastsRes = await fetch(`${API_BASE}/api/scheduler/broadcasts`);
                if (broadcastsRes.ok) {
                    const data = await broadcastsRes.json();
                    setBroadcasts(data.data || []);
                }
            } catch (e) { }
        } catch (e) {
            console.error('Failed to fetch scheduler data:', e);
        }
        setIsLoading(false);
    }, []);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, [fetchData]);

    const scheduleMessage = async () => {
        if (!newMessage.chatId || !newMessage.message) return;

        try {
            const res = await fetch(`${API_BASE}/api/scheduler/schedule`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: selectedSessionId,
                    chatId: newMessage.chatId.includes('@') ? newMessage.chatId : `${newMessage.chatId.replace(/\D/g, '')}@c.us`,
                    message: newMessage.message,
                    scheduledAt: newMessage.scheduledAt || undefined
                })
            });

            if (res.ok) {
                toast.success('Mensagem agendada!');
                setNewMessage({ chatId: '', message: '', scheduledAt: '' });
                fetchData();
            }
        } catch (e) {
            toast.error('Erro ao agendar mensagem');
        }
    };

    const createTemplate = async () => {
        if (!newTemplate.name || !newTemplate.content) return;

        try {
            const res = await fetch(`${API_BASE}/api/scheduler/templates`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newTemplate)
            });

            if (res.ok) {
                toast.success('Template criado!');
                setNewTemplate({ name: '', content: '', category: 'general' });
                fetchData();
            }
        } catch (e) {
            toast.error('Erro ao criar template');
        }
    };

    const cancelMessage = async (id: string) => {
        try {
            await fetch(`${API_BASE}/api/scheduler/${id}`, { method: 'DELETE' });
            toast.success('Mensagem cancelada');
            fetchData();
        } catch (e) {
            toast.error('Erro ao cancelar mensagem');
        }
    };

    const deleteTemplate = async (id: string) => {
        try {
            await fetch(`${API_BASE}/api/scheduler/templates/${id}`, { method: 'DELETE' });
            toast.success('Template excluído');
            fetchData();
        } catch (e) {
            toast.error('Erro ao excluir template');
        }
    };

    const toggleFlow = async (id: string) => {
        try {
            await fetch(`${API_BASE}/api/webhook/flows/${id}/toggle`, { method: 'PATCH' });
            toast.success('Fluxo atualizado');
            fetchData();
        } catch (e) {
            toast.error('Erro ao atualizar fluxo');
        }
    };

    const toggleRule = async (id: string) => {
        try {
            await fetch(`${API_BASE}/api/webhook/rules/${id}/toggle`, { method: 'PATCH' });
            toast.success('Regra atualizada');
            fetchData();
        } catch (e) {
            toast.error('Erro ao atualizar regra');
        }
    };

    const deleteRule = async (id: string) => {
        if (!confirm('Deseja excluir esta regra?')) return;
        try {
            await fetch(`${API_BASE}/api/webhook/rules/${id}`, { method: 'DELETE' });
            toast.success('Regra excluída');
            fetchData();
        } catch (e) {
            toast.error('Erro ao excluir regra');
        }
    };

    const testRule = async (id: string) => {
        try {
            const res = await fetch(`${API_BASE}/api/webhook/rules/${id}/test`, { method: 'POST' });
            if (res.ok) {
                const result = await res.json();
                setTestResult(result);
                toast.success('Teste executado!');
            } else {
                toast.error('Erro ao testar regra');
            }
        } catch (e) {
            toast.error('Erro ao testar regra');
        }
    };

    const fetchBroadcastDetails = async (broadcastId: string) => {
        try {
            const res = await fetch(`${API_BASE}/api/scheduler/broadcasts/${broadcastId}`);
            if (res.ok) {
                setSelectedBroadcast(await res.json());
            }
        } catch (e) {
            toast.error('Erro ao buscar detalhes');
        }
    };

    const getEventVariables = (event: string): string[] => {
        return eventVariables[event] || ['{{customerName}}', '{{ref}}', '{{total}}'];
    };

    const saveRule = async () => {
        if (!editingRule) return;
        try {
            const res = await fetch(`${API_BASE}/api/webhook/rules/${editingRule.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: editingRule.name,
                    message: editingRule.message,
                    delay: editingRule.delay,
                    sessionId: editingRule.sessionId
                })
            });
            if (res.ok) {
                toast.success('Regra salva!');
                setEditingRule(null);
                fetchData();
            }
        } catch (e) {
            toast.error('Erro ao salvar regra');
        }
    };

    const createRule = async () => {
        if (!newRule.name || !newRule.event) {
            toast.error('Preencha nome e evento');
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/api/webhook/rules`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...newRule, sessionId: selectedSessionId })
            });
            if (res.ok) {
                toast.success('Regra criada!');
                setNewRule({ name: '', event: 'invoice_created', message: '', delay: 0 });
                setShowNewRuleForm(false);
                fetchData();
            }
        } catch (e) {
            toast.error('Erro ao criar regra');
        }
    };

    const createFlow = async () => {
        if (!newFlow.name || !newFlow.triggerKeywords) {
            toast.error('Preencha nome e palavras-chave');
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/api/webhook/flows`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newFlow.name,
                    triggerKeywords: newFlow.triggerKeywords.split(',').map(k => k.trim()),
                    sessionId: selectedSessionId,
                    steps: [{ id: 'step_1', message: 'Olá! Como posso ajudar?', waitForResponse: true }]
                })
            });
            if (res.ok) {
                toast.success('Fluxo criado!');
                setNewFlow({ name: '', triggerKeywords: '' });
                setShowNewFlowForm(false);
                fetchData();
            }
        } catch (e) {
            toast.error('Erro ao criar fluxo');
        }
    };

    const deleteFlow = async (id: string) => {
        if (!confirm('Deseja excluir este fluxo?')) return;
        try {
            await fetch(`${API_BASE}/api/webhook/flows/${id}`, { method: 'DELETE' });
            toast.success('Fluxo excluído');
            fetchData();
        } catch (e) {
            toast.error('Erro ao excluir fluxo');
        }
    };

    const sendBroadcast = async () => {
        if (!broadcast.csvContent || !broadcast.message) {
            toast.error('Preencha CSV e mensagem');
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/api/scheduler/import-csv`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    csvContent: broadcast.csvContent,
                    sessionId: selectedSessionId,
                    message: broadcast.message,
                    delayBetween: broadcast.delayBetween * 1000
                })
            });
            const data = await res.json();
            if (res.ok) {
                toast.success(`Broadcast criado! ${data.contactsFound} contatos encontrados.`);
                setBroadcast({ csvContent: '', message: '', delayBetween: 3 });
                fetchData();
            } else {
                toast.error(data.error || 'Erro no broadcast');
            }
        } catch (e) {
            toast.error('Erro ao enviar broadcast');
        }
    };

    const formatDate = (ts: number) => new Date(ts).toLocaleString('pt-BR');
    const formatPhone = (chatId: string) => chatId.replace('@c.us', '').replace('@g.us', ' (Grupo)');

    const inputStyle: React.CSSProperties = {
        padding: '10px 12px',
        borderRadius: '8px',
        border: '1px solid #e2e8f0',
        fontSize: '14px',
        width: '100%',
        boxSizing: 'border-box'
    };

    const buttonStyle: React.CSSProperties = {
        padding: '10px 20px',
        borderRadius: '8px',
        border: 'none',
        cursor: 'pointer',
        fontWeight: 'bold',
        fontSize: '14px'
    };

    const cardStyle: React.CSSProperties = {
        padding: '20px',
        background: 'white',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
    };

    return (
        <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto', background: '#f8fafc', minHeight: '100vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
                <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px', color: '#1e293b' }}>
                    📅 Automação de Mensagens
                    <button onClick={fetchData} style={{ ...buttonStyle, background: '#f1f5f9', color: '#475569', fontSize: '12px', padding: '6px 12px' }}>🔄 Atualizar</button>
                </h1>
                {/* Session Selector */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', color: '#64748b' }}>📱 Conta:</span>
                    <select
                        value={selectedSessionId}
                        onChange={e => setSelectedSessionId(e.target.value)}
                        style={{
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: '1px solid #e2e8f0',
                            fontSize: '13px',
                            background: 'white',
                            minWidth: '150px'
                        }}
                    >
                        <option value="default">default</option>
                        {sessions.map(s => (
                            <option key={s.id} value={s.id}>
                                {s.name || s.id} {s.status === 'CONNECTED' ? '✓' : ''}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Stats Cards */}
            {stats && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '25px' }}>
                    <StatCard label="Pendentes" value={stats.pending} color="#f59e0b" />
                    <StatCard label="Enviados Hoje" value={stats.logsSentToday} color="#10b981" />
                    <StatCard label="Falhas Hoje" value={stats.logsFailedToday} color="#ef4444" />
                    <StatCard label="Templates" value={stats.templates} color="#6366f1" />
                    <StatCard label="Regras Ativas" value={stats.activeRules} color="#8b5cf6" />
                    <StatCard label="Fluxos" value={stats.chatFlows} color="#ec4899" />
                </div>
            )}

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '2px solid #e5e7eb', paddingBottom: '10px', flexWrap: 'wrap' }}>
                {(['rules', 'pending', 'logs', 'templates', 'flows', 'broadcast', 'schedule'] as const).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        style={{
                            padding: '10px 18px',
                            border: 'none',
                            background: activeTab === tab ? '#3b82f6' : '#f3f4f6',
                            color: activeTab === tab ? 'white' : '#374151',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontWeight: activeTab === tab ? 'bold' : 'normal',
                            fontSize: '13px'
                        }}
                    >
                        {tab === 'rules' && '⚡ Regras'}
                        {tab === 'pending' && '⏳ Pendentes'}
                        {tab === 'logs' && '📊 Histórico'}
                        {tab === 'templates' && '📝 Templates'}
                        {tab === 'flows' && '🤖 Fluxos'}
                        {tab === 'broadcast' && '📢 Broadcast'}
                        {tab === 'schedule' && '➕ Agendar'}
                    </button>
                ))}
            </div>

            {isLoading ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>Carregando...</div>
            ) : (
                <>
                    {/* Rules Tab */}
                    {activeTab === 'rules' && (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                                <h3 style={{ margin: 0, color: '#1e293b' }}>Regras de Automação</h3>
                                <button
                                    onClick={() => setShowNewRuleForm(!showNewRuleForm)}
                                    style={{ ...buttonStyle, background: '#10b981', color: 'white' }}
                                >
                                    {showNewRuleForm ? '✕ Cancelar' : '+ Nova Regra'}
                                </button>
                            </div>

                            {/* New Rule Form */}
                            {showNewRuleForm && (
                                <div style={{ ...cardStyle, marginBottom: '20px', background: '#f0fdf4' }}>
                                    <h4 style={{ marginTop: 0, color: '#166534' }}>Criar Nova Regra</h4>
                                    <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                                        <div>
                                            <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569' }}>Nome</label>
                                            <input
                                                value={newRule.name}
                                                onChange={e => setNewRule({ ...newRule, name: e.target.value })}
                                                placeholder="Ex: Notificação de Pedido"
                                                style={inputStyle}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569' }}>Evento</label>
                                            <select
                                                value={newRule.event}
                                                onChange={e => setNewRule({ ...newRule, event: e.target.value })}
                                                style={inputStyle}
                                            >
                                                {AVAILABLE_EVENTS.map(ev => (
                                                    <option key={ev.value} value={ev.value}>{ev.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569' }}>Delay (min)</label>
                                            <input
                                                type="number"
                                                value={newRule.delay}
                                                onChange={e => setNewRule({ ...newRule, delay: parseInt(e.target.value) || 0 })}
                                                style={inputStyle}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569' }}>Conta WhatsApp</label>
                                            <div style={{
                                                padding: '10px 12px',
                                                borderRadius: '8px',
                                                border: '1px solid #e2e8f0',
                                                fontSize: '14px',
                                                background: '#f1f5f9',
                                                color: '#334155'
                                            }}>
                                                📱 {sessions.find(s => s.id === selectedSessionId)?.name || selectedSessionId}
                                            </div>
                                            <small style={{ color: '#64748b' }}>Altere no seletor acima</small>
                                        </div>
                                    </div>
                                    <div style={{ marginTop: '12px' }}>
                                        <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569' }}>Mensagem (use {'{{variável}}'} para dados dinâmicos)</label>
                                        <textarea
                                            value={newRule.message}
                                            onChange={e => setNewRule({ ...newRule, message: e.target.value })}
                                            placeholder="Olá {{customerName}}! Seu pedido {{ref}} foi criado."
                                            rows={3}
                                            style={{ ...inputStyle, resize: 'vertical' }}
                                        />
                                    </div>
                                    <button onClick={createRule} style={{ ...buttonStyle, background: '#10b981', color: 'white', marginTop: '12px' }}>
                                        ✓ Criar Regra
                                    </button>
                                </div>
                            )}

                            <div style={{ display: 'grid', gap: '15px' }}>
                                {rules.map(rule => (
                                    <div key={rule.id} style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                            <div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                    <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold', color: '#1e293b' }}>{rule.name}</h4>
                                                    <span style={{
                                                        fontSize: '11px',
                                                        background: '#e0f2fe',
                                                        color: '#0369a1',
                                                        padding: '2px 8px',
                                                        borderRadius: '12px',
                                                        fontFamily: 'monospace'
                                                    }}>
                                                        {rule.event}
                                                    </span>
                                                </div>
                                                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                                                    📱 Conta: {rule.sessionId} • ⏱️ Delay: {rule.delay || 0} min
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <button
                                                    onClick={() => setEditingRule(rule)}
                                                    style={{ ...buttonStyle, background: '#f1f5f9', color: '#475569', padding: '6px 12px', fontSize: '12px' }}
                                                >
                                                    ✏️ Editar
                                                </button>
                                                <button
                                                    onClick={() => deleteRule(rule.id)}
                                                    style={{ ...buttonStyle, background: '#fee2e2', color: '#dc2626', padding: '6px 12px', fontSize: '12px' }}
                                                >
                                                    🗑️
                                                </button>
                                                <button
                                                    onClick={() => testRule(rule.id)}
                                                    style={{ ...buttonStyle, background: '#dbeafe', color: '#1d4ed8', padding: '6px 12px', fontSize: '12px' }}
                                                    title="Testar regra sem enviar mensagem"
                                                >
                                                    🧪 Testar
                                                </button>
                                                <button
                                                    onClick={() => toggleRule(rule.id)}
                                                    style={{
                                                        ...buttonStyle,
                                                        padding: '6px 14px',
                                                        fontSize: '12px',
                                                        background: rule.enabled ? '#dcfce7' : '#f1f5f9',
                                                        color: rule.enabled ? '#15803d' : '#64748b'
                                                    }}
                                                >
                                                    {rule.enabled ? '✓ ATIVO' : 'INATIVO'}
                                                </button>
                                            </div>
                                        </div>

                                        <div style={{
                                            background: '#f8fafc',
                                            padding: '12px',
                                            borderRadius: '8px',
                                            fontSize: '13px',
                                            color: '#334155',
                                            whiteSpace: 'pre-wrap',
                                            border: '1px solid #e2e8f0'
                                        }}>
                                            {rule.message || '(Sem mensagem definida)'}
                                        </div>

                                        {/* Variables available for this event */}
                                        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '8px' }}>
                                            📌 Variáveis disponíveis: {getEventVariables(rule.event).join(', ')}
                                        </div>
                                    </div>
                                ))}
                                {rules.length === 0 && <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>Nenhuma regra encontrada.</div>}
                            </div>
                        </div>
                    )}

                    {/* Edit Rule Modal */}
                    {editingRule && (
                        <div style={{
                            position: 'fixed',
                            top: 0, left: 0, right: 0, bottom: 0,
                            background: 'rgba(0,0,0,0.5)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 1000
                        }}>
                            <div style={{ ...cardStyle, width: '90%', maxWidth: '600px', maxHeight: '90vh', overflow: 'auto' }}>
                                <h3 style={{ marginTop: 0, color: '#1e293b' }}>Editar Regra</h3>
                                <div style={{ display: 'grid', gap: '12px' }}>
                                    <div>
                                        <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569' }}>Nome</label>
                                        <input
                                            value={editingRule.name}
                                            onChange={e => setEditingRule({ ...editingRule, name: e.target.value })}
                                            style={inputStyle}
                                        />
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                        <div>
                                            <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569' }}>Delay (minutos)</label>
                                            <input
                                                type="number"
                                                value={editingRule.delay || 0}
                                                onChange={e => setEditingRule({ ...editingRule, delay: parseInt(e.target.value) || 0 })}
                                                style={inputStyle}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569' }}>Conta WhatsApp</label>
                                            <select
                                                value={editingRule.sessionId}
                                                onChange={e => setEditingRule({ ...editingRule, sessionId: e.target.value })}
                                                style={inputStyle}
                                            >
                                                <option value="default">default</option>
                                                {sessions.map(s => (
                                                    <option key={s.id} value={s.id}>
                                                        {s.name || s.id} {s.status === 'CONNECTED' ? '✓' : ''}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569' }}>Mensagem</label>
                                        <textarea
                                            value={editingRule.message || ''}
                                            onChange={e => setEditingRule({ ...editingRule, message: e.target.value })}
                                            rows={5}
                                            style={{ ...inputStyle, resize: 'vertical' }}
                                        />
                                        <small style={{ color: '#64748b' }}>Variáveis: {'{{customerName}}'}, {'{{ref}}'}, {'{{total}}'}, {'{{subject}}'}</small>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                                    <button onClick={saveRule} style={{ ...buttonStyle, background: '#3b82f6', color: 'white', flex: 1 }}>
                                        💾 Salvar
                                    </button>
                                    <button onClick={() => setEditingRule(null)} style={{ ...buttonStyle, background: '#f1f5f9', color: '#475569', flex: 1 }}>
                                        Cancelar
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Logs / History Tab */}
                    {activeTab === 'logs' && (
                        <div>
                            <h3 style={{ marginBottom: '20px', color: '#1e293b' }}>📊 Histórico de Mensagens</h3>
                            {logs.length === 0 ? (
                                <p style={{ color: '#64748b', textAlign: 'center', padding: '40px' }}>Nenhum log encontrado.</p>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {logs.map(log => (
                                        <div key={log.id} style={{
                                            ...cardStyle,
                                            padding: '12px 16px',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            background: log.status === 'sent' ? '#f0fdf4' : log.status === 'failed' ? '#fef2f2' : '#fefce8'
                                        }}>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span style={{
                                                        fontSize: '11px',
                                                        padding: '2px 6px',
                                                        borderRadius: '4px',
                                                        background: log.status === 'sent' ? '#dcfce7' : log.status === 'failed' ? '#fee2e2' : '#fef9c3',
                                                        color: log.status === 'sent' ? '#166534' : log.status === 'failed' ? '#dc2626' : '#a16207'
                                                    }}>
                                                        {log.status === 'sent' ? '✓ Enviado' : log.status === 'failed' ? '✗ Falha' : '⏳ Pendente'}
                                                    </span>
                                                    <span style={{ fontSize: '12px', color: '#64748b' }}>{log.type}</span>
                                                    <span style={{ fontWeight: 'bold', color: '#334155' }}>{formatPhone(log.chatId)}</span>
                                                </div>
                                                <div style={{ fontSize: '13px', color: '#475569', marginTop: '4px' }}>
                                                    {log.message.substring(0, 100)}{log.message.length > 100 ? '...' : ''}
                                                </div>
                                                {log.error && <div style={{ fontSize: '12px', color: '#dc2626', marginTop: '2px' }}>Erro: {log.error}</div>}
                                            </div>
                                            <div style={{ fontSize: '11px', color: '#94a3b8', textAlign: 'right', minWidth: '100px' }}>
                                                {formatDate(log.sentAt || log.createdAt)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Pending Messages */}
                    {activeTab === 'pending' && (
                        <div>
                            <h3 style={{ marginBottom: '20px', color: '#1e293b' }}>Mensagens Pendentes ({pending.length})</h3>
                            {pending.length === 0 ? (
                                <p style={{ color: '#64748b', textAlign: 'center', padding: '40px' }}>Nenhuma mensagem agendada.</p>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {pending.map(msg => (
                                        <div key={msg.id} style={{
                                            ...cardStyle,
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center'
                                        }}>
                                            <div>
                                                <div style={{ fontWeight: 'bold', color: '#1e293b' }}>{formatPhone(msg.chatId)}</div>
                                                <div style={{ color: '#64748b', fontSize: '14px' }}>{msg.message.substring(0, 80)}...</div>
                                                <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                                                    Agendado para: {formatDate(msg.scheduledAt)}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => cancelMessage(msg.id)}
                                                style={{ ...buttonStyle, background: '#ef4444', color: 'white' }}
                                            >
                                                Cancelar
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Templates */}
                    {activeTab === 'templates' && (
                        <div>
                            <h3 style={{ marginBottom: '20px', color: '#1e293b' }}>Templates de Mensagem</h3>
                            <div style={{ ...cardStyle, marginBottom: '20px' }}>
                                <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                                    <input
                                        placeholder="Nome do template"
                                        value={newTemplate.name}
                                        onChange={e => setNewTemplate({ ...newTemplate, name: e.target.value })}
                                        style={inputStyle}
                                    />
                                    <select
                                        value={newTemplate.category}
                                        onChange={e => setNewTemplate({ ...newTemplate, category: e.target.value })}
                                        style={inputStyle}
                                    >
                                        <option value="general">Geral</option>
                                        <option value="reminder">Lembrete</option>
                                        <option value="confirmation">Confirmação</option>
                                        <option value="news">Novidades</option>
                                    </select>
                                </div>
                                <textarea
                                    placeholder="Conteúdo do template (use {{variável}} para variáveis)"
                                    value={newTemplate.content}
                                    onChange={e => setNewTemplate({ ...newTemplate, content: e.target.value })}
                                    rows={3}
                                    style={{ ...inputStyle, marginTop: '12px', resize: 'vertical' }}
                                />
                                <button onClick={createTemplate} style={{ ...buttonStyle, background: '#10b981', color: 'white', marginTop: '12px' }}>
                                    + Criar Template
                                </button>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {templates.map(tpl => (
                                    <div key={tpl.id} style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', background: '#f0fdf4' }}>
                                        <div>
                                            <div style={{ fontWeight: 'bold', color: '#1e293b' }}>{tpl.name}</div>
                                            <div style={{ color: '#64748b', fontSize: '14px' }}>{tpl.content}</div>
                                            <span style={{ fontSize: '11px', background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: '4px' }}>{tpl.category}</span>
                                        </div>
                                        <button onClick={() => deleteTemplate(tpl.id)} style={{ ...buttonStyle, background: '#ef4444', color: 'white' }}>
                                            Excluir
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Flows */}
                    {activeTab === 'flows' && (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                                <h3 style={{ margin: 0, color: '#1e293b' }}>Fluxos de Chatbot</h3>
                                <button
                                    onClick={() => setShowNewFlowForm(!showNewFlowForm)}
                                    style={{ ...buttonStyle, background: '#ec4899', color: 'white' }}
                                >
                                    {showNewFlowForm ? '✕ Cancelar' : '+ Novo Fluxo'}
                                </button>
                            </div>

                            {showNewFlowForm && (
                                <div style={{ ...cardStyle, marginBottom: '20px', background: '#fdf4ff' }}>
                                    <h4 style={{ marginTop: 0, color: '#86198f' }}>Criar Novo Fluxo</h4>
                                    <div style={{ display: 'grid', gap: '12px' }}>
                                        <div>
                                            <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569' }}>Nome do Fluxo</label>
                                            <input
                                                value={newFlow.name}
                                                onChange={e => setNewFlow({ ...newFlow, name: e.target.value })}
                                                placeholder="Ex: Atendimento Inicial"
                                                style={inputStyle}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569' }}>Palavras-chave (separadas por vírgula)</label>
                                            <input
                                                value={newFlow.triggerKeywords}
                                                onChange={e => setNewFlow({ ...newFlow, triggerKeywords: e.target.value })}
                                                placeholder="oi, olá, menu, ajuda"
                                                style={inputStyle}
                                            />
                                        </div>
                                    </div>
                                    <button onClick={createFlow} style={{ ...buttonStyle, background: '#ec4899', color: 'white', marginTop: '12px' }}>
                                        ✓ Criar Fluxo
                                    </button>
                                </div>
                            )}

                            {flows.length === 0 ? (
                                <p style={{ color: '#64748b', textAlign: 'center', padding: '40px' }}>Nenhum fluxo configurado.</p>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {flows.map(flow => (
                                        <div key={flow.id} style={{
                                            ...cardStyle,
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            background: flow.enabled ? '#eff6ff' : '#f3f4f6'
                                        }}>
                                            <div>
                                                <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', color: '#1e293b' }}>
                                                    {flow.name}
                                                    <span style={{
                                                        fontSize: '12px',
                                                        background: flow.enabled ? '#10b981' : '#9ca3af',
                                                        color: 'white',
                                                        padding: '2px 8px',
                                                        borderRadius: '10px'
                                                    }}>
                                                        {flow.enabled ? 'Ativo' : 'Inativo'}
                                                    </span>
                                                </div>
                                                <div style={{ color: '#64748b', fontSize: '14px' }}>
                                                    Gatilhos: {flow.triggerKeywords.join(', ')} • {flow.steps.length} passos
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button
                                                    onClick={() => toggleFlow(flow.id)}
                                                    style={{ ...buttonStyle, background: flow.enabled ? '#f59e0b' : '#10b981', color: 'white' }}
                                                >
                                                    {flow.enabled ? 'Desativar' : 'Ativar'}
                                                </button>
                                                <button
                                                    onClick={() => deleteFlow(flow.id)}
                                                    style={{ ...buttonStyle, background: '#fee2e2', color: '#dc2626' }}
                                                >
                                                    🗑️
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Broadcast */}
                    {activeTab === 'broadcast' && (
                        <div>
                            <h3 style={{ marginBottom: '20px', color: '#1e293b' }}>📢 Envio em Massa (Broadcast)</h3>
                            <div style={cardStyle}>
                                <div style={{ marginBottom: '16px' }}>
                                    <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '6px' }}>
                                        Lista de Contatos (CSV ou um telefone por linha)
                                    </label>
                                    <textarea
                                        value={broadcast.csvContent}
                                        onChange={e => setBroadcast({ ...broadcast, csvContent: e.target.value })}
                                        placeholder="5511999998888
5511888887777
nome,telefone
João,5511777776666"
                                        rows={6}
                                        style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace' }}
                                    />
                                    <small style={{ color: '#64748b' }}>Cole números de telefone (com DDD) ou dados CSV com coluna "telefone" ou "phone"</small>
                                </div>
                                <div style={{ marginBottom: '16px' }}>
                                    <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '6px' }}>
                                        Mensagem
                                    </label>
                                    <textarea
                                        value={broadcast.message}
                                        onChange={e => setBroadcast({ ...broadcast, message: e.target.value })}
                                        placeholder="Digite a mensagem que será enviada para todos..."
                                        rows={4}
                                        style={{ ...inputStyle, resize: 'vertical' }}
                                    />
                                </div>
                                <div style={{ marginBottom: '16px' }}>
                                    <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '6px' }}>
                                        Intervalo entre mensagens (segundos)
                                    </label>
                                    <input
                                        type="number"
                                        value={broadcast.delayBetween}
                                        onChange={e => setBroadcast({ ...broadcast, delayBetween: parseInt(e.target.value) || 3 })}
                                        min={1}
                                        max={60}
                                        style={{ ...inputStyle, maxWidth: '120px' }}
                                    />
                                </div>
                                <button onClick={sendBroadcast} style={{ ...buttonStyle, background: '#3b82f6', color: 'white', width: '100%', padding: '14px' }}>
                                    📤 Enviar Broadcast
                                </button>
                            </div>

                            {/* Previous Broadcasts */}
                            {broadcasts.length > 0 && (
                                <div style={{ ...cardStyle, marginTop: '20px' }}>
                                    <h4 style={{ marginTop: 0, marginBottom: '15px', color: '#1e293b' }}>📋 Broadcasts Anteriores</h4>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {broadcasts.map(b => (
                                            <div
                                                key={b.broadcastId}
                                                onClick={() => fetchBroadcastDetails(b.broadcastId)}
                                                style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    padding: '12px',
                                                    background: '#f8fafc',
                                                    borderRadius: '8px',
                                                    cursor: 'pointer',
                                                    border: '1px solid #e2e8f0'
                                                }}
                                            >
                                                <div>
                                                    <div style={{ fontWeight: 'bold', fontSize: '13px' }}>{b.broadcastId}</div>
                                                    <div style={{ fontSize: '11px', color: '#64748b' }}>
                                                        {b.count} contatos • {new Date(b.createdAt).toLocaleDateString('pt-BR')}
                                                    </div>
                                                </div>
                                                <span style={{
                                                    padding: '4px 10px',
                                                    borderRadius: '12px',
                                                    fontSize: '11px',
                                                    background: b.status === 'completed' ? '#dcfce7' : b.status === 'in_progress' ? '#fef3c7' : '#dbeafe',
                                                    color: b.status === 'completed' ? '#16a34a' : b.status === 'in_progress' ? '#d97706' : '#1d4ed8'
                                                }}>
                                                    {b.status === 'completed' ? '✓ Concluído' : b.status === 'in_progress' ? '⏳ Em andamento' : '📋 Pendente'}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Schedule New */}
                    {activeTab === 'schedule' && (
                        <div>
                            <h3 style={{ marginBottom: '20px', color: '#1e293b' }}>Agendar Nova Mensagem</h3>
                            <div style={{ ...cardStyle, maxWidth: '500px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '12px', color: '#475569' }}>Telefone/ChatID</label>
                                        <input
                                            placeholder="5511999999999 ou 5511999@c.us"
                                            value={newMessage.chatId}
                                            onChange={e => setNewMessage({ ...newMessage, chatId: e.target.value })}
                                            style={inputStyle}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '12px', color: '#475569' }}>Mensagem</label>
                                        <textarea
                                            placeholder="Digite a mensagem..."
                                            value={newMessage.message}
                                            onChange={e => setNewMessage({ ...newMessage, message: e.target.value })}
                                            rows={4}
                                            style={{ ...inputStyle, resize: 'vertical' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '12px', color: '#475569' }}>Agendar para (opcional)</label>
                                        <input
                                            type="datetime-local"
                                            value={newMessage.scheduledAt}
                                            onChange={e => setNewMessage({ ...newMessage, scheduledAt: e.target.value })}
                                            style={inputStyle}
                                        />
                                        <small style={{ color: '#64748b' }}>Deixe vazio para enviar imediatamente</small>
                                    </div>
                                    <button
                                        onClick={scheduleMessage}
                                        style={{ ...buttonStyle, padding: '15px', background: '#3b82f6', color: 'white', fontSize: '16px' }}
                                    >
                                        📤 Agendar Mensagem
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Test Result Modal */}
            {testResult && (
                <div style={{
                    position: 'fixed',
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000
                }}>
                    <div style={{ ...cardStyle, width: '90%', maxWidth: '600px', maxHeight: '90vh', overflow: 'auto' }}>
                        <h3 style={{ marginTop: 0, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            🧪 Resultado do Teste
                            <span style={{ fontSize: '12px', background: '#dbeafe', color: '#1d4ed8', padding: '4px 8px', borderRadius: '12px' }}>
                                DRY-RUN
                            </span>
                        </h3>

                        <div style={{ marginBottom: '15px' }}>
                            <strong>Regra:</strong> {testResult.rule?.name} ({testResult.rule?.event})
                        </div>

                        <div style={{ marginBottom: '15px' }}>
                            <strong>Conta WhatsApp:</strong> {testResult.rule?.sessionId}
                        </div>

                        <div style={{ marginBottom: '15px' }}>
                            <strong>Delay:</strong> {testResult.delay} minutos
                        </div>

                        <div style={{ marginBottom: '15px' }}>
                            <strong>Variáveis de Exemplo:</strong>
                            <pre style={{ background: '#f1f5f9', padding: '10px', borderRadius: '8px', fontSize: '12px', overflow: 'auto' }}>
                                {JSON.stringify(testResult.mockVariables, null, 2)}
                            </pre>
                        </div>

                        <div style={{ marginBottom: '15px' }}>
                            <strong>Mensagem Renderizada:</strong>
                            <div style={{
                                background: '#ecfdf5',
                                padding: '15px',
                                borderRadius: '8px',
                                border: '1px solid #10b981',
                                whiteSpace: 'pre-wrap'
                            }}>
                                {testResult.renderedMessage}
                            </div>
                        </div>

                        <button
                            onClick={() => setTestResult(null)}
                            style={{ ...buttonStyle, background: '#3b82f6', color: 'white', width: '100%' }}
                        >
                            Fechar
                        </button>
                    </div>
                </div>
            )}

            {/* Broadcast Details Modal */}
            {selectedBroadcast && (
                <div style={{
                    position: 'fixed',
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000
                }}>
                    <div style={{ ...cardStyle, width: '90%', maxWidth: '700px', maxHeight: '90vh', overflow: 'auto' }}>
                        <h3 style={{ marginTop: 0, color: '#1e293b' }}>
                            📢 Broadcast: {selectedBroadcast.broadcastId}
                        </h3>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '20px' }}>
                            <div style={{ background: '#f1f5f9', padding: '10px', borderRadius: '8px', textAlign: 'center' }}>
                                <div style={{ fontSize: '20px', fontWeight: 'bold' }}>{selectedBroadcast.totalCount}</div>
                                <div style={{ fontSize: '11px', color: '#64748b' }}>Total</div>
                            </div>
                            <div style={{ background: '#fef3c7', padding: '10px', borderRadius: '8px', textAlign: 'center' }}>
                                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#d97706' }}>{selectedBroadcast.pending}</div>
                                <div style={{ fontSize: '11px', color: '#64748b' }}>Pendentes</div>
                            </div>
                            <div style={{ background: '#dcfce7', padding: '10px', borderRadius: '8px', textAlign: 'center' }}>
                                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#16a34a' }}>{selectedBroadcast.sent}</div>
                                <div style={{ fontSize: '11px', color: '#64748b' }}>Enviados</div>
                            </div>
                            <div style={{ background: '#fee2e2', padding: '10px', borderRadius: '8px', textAlign: 'center' }}>
                                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#dc2626' }}>{selectedBroadcast.failed}</div>
                                <div style={{ fontSize: '11px', color: '#64748b' }}>Falhas</div>
                            </div>
                        </div>

                        <div style={{ maxHeight: '300px', overflow: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                                <thead>
                                    <tr style={{ background: '#f1f5f9' }}>
                                        <th style={{ padding: '8px', textAlign: 'left' }}>Contato</th>
                                        <th style={{ padding: '8px', textAlign: 'left' }}>Status</th>
                                        <th style={{ padding: '8px', textAlign: 'left' }}>Agendado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {selectedBroadcast.messages?.map((msg: any) => (
                                        <tr key={msg.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                            <td style={{ padding: '8px' }}>{msg.chatId}</td>
                                            <td style={{ padding: '8px' }}>
                                                <span style={{
                                                    padding: '2px 8px',
                                                    borderRadius: '12px',
                                                    fontSize: '10px',
                                                    background: msg.status === 'sent' ? '#dcfce7' : msg.status === 'failed' ? '#fee2e2' : '#fef3c7',
                                                    color: msg.status === 'sent' ? '#16a34a' : msg.status === 'failed' ? '#dc2626' : '#d97706'
                                                }}>
                                                    {msg.status}
                                                </span>
                                            </td>
                                            <td style={{ padding: '8px' }}>{new Date(msg.scheduledAt).toLocaleString('pt-BR')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <button
                            onClick={() => setSelectedBroadcast(null)}
                            style={{ ...buttonStyle, background: '#3b82f6', color: 'white', width: '100%', marginTop: '15px' }}
                        >
                            Fechar
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

const StatCard: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
    <div style={{
        padding: '16px',
        background: 'white',
        borderRadius: '12px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        borderLeft: `4px solid ${color}`
    }}>
        <div style={{ fontSize: '24px', fontWeight: 'bold', color }}>{value}</div>
        <div style={{ color: '#64748b', fontSize: '13px' }}>{label}</div>
    </div>
);

export default SchedulerAdmin;
