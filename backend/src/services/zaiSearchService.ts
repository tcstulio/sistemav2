// Busca na web via MCP remoto da Z.AI (web_search_prime) — INCLUSO no GLM Coding Plan
// (cota da assinatura, sem custo por uso adicional). Protocolo: MCP streamable HTTP —
// initialize captura o mcp-session-id e as chamadas seguintes o enviam como header.
// Validado ao vivo em 2026-07-03 (tool name exato: 'web_search_prime').
import axios from 'axios';
import { config } from '../config/env';
import { logger } from '../utils/logger';

const log = logger.child('ZaiSearch');

const MCP_URL = 'https://api.z.ai/api/mcp/web_search_prime/mcp';

export interface WebSearchResult {
    title: string;
    link: string;
    content: string;
}

class ZaiSearchService {
    private sessionId: string | null = null;
    private rpcId = 0;

    private headers(extra?: Record<string, string>) {
        return {
            'Authorization': `Bearer ${config.zaiApiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            ...(extra || {}),
        };
    }

    // Resposta vem como SSE (event-stream) mesmo em chamadas unárias; extrai o JSON do "data:".
    private parseSse(raw: string): any {
        const line = String(raw).split('\n').find((l) => l.startsWith('data:'));
        if (!line) throw new Error('Resposta MCP sem payload.');
        return JSON.parse(line.slice(5).trim());
    }

    private async initialize(): Promise<void> {
        const resp = await axios.post(MCP_URL, {
            jsonrpc: '2.0', id: ++this.rpcId, method: 'initialize',
            params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'sistemav2-agent', version: '1.0' } },
        }, { headers: this.headers(), timeout: 30000, responseType: 'text' });
        const sid = resp.headers['mcp-session-id'];
        if (!sid) throw new Error('MCP initialize sem mcp-session-id.');
        this.sessionId = String(sid);
        log.info('Sessão MCP web-search iniciada');
    }

    /** Busca na web; retorna os top-N resultados estruturados. Renova a sessão MCP se expirar. */
    async search(query: string, topN = 5): Promise<WebSearchResult[]> {
        if (!config.zaiApiKey) throw new Error('ZAI_API_KEY ausente.');
        const q = (query || '').trim();
        if (!q) throw new Error('Consulta vazia.');

        const call = async (): Promise<WebSearchResult[]> => {
            if (!this.sessionId) await this.initialize();
            const resp = await axios.post(MCP_URL, {
                jsonrpc: '2.0', id: ++this.rpcId, method: 'tools/call',
                params: { name: 'web_search_prime', arguments: { search_query: q } },
            }, { headers: this.headers({ 'mcp-session-id': this.sessionId! }), timeout: 60000, responseType: 'text' });
            const payload = this.parseSse(resp.data);
            if (payload.error) throw new Error(`MCP: ${payload.error.message || 'erro'}`);
            // content[0].text é um JSON (string) com a lista de resultados
            const text = payload.result?.content?.[0]?.text || '[]';
            let items: any[] = [];
            try {
                const parsed = JSON.parse(text);
                items = Array.isArray(parsed) ? parsed : JSON.parse(parsed);
            } catch { items = []; }
            return (items || []).slice(0, topN).map((r: any) => ({
                title: String(r.title || '').slice(0, 200),
                link: String(r.link || r.url || ''),
                content: String(r.content || r.snippet || '').slice(0, 500),
            }));
        };

        try {
            return await call();
        } catch (e: any) {
            // sessão expirada/perdida → re-inicializa uma vez
            const status = e?.response?.status;
            if (status === 400 || status === 404 || /session/i.test(String(e?.message))) {
                log.info('Sessão MCP expirada — renovando');
                this.sessionId = null;
                return await call();
            }
            throw e;
        }
    }
}

export const zaiSearchService = new ZaiSearchService();
