import fs from 'fs';
import path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';
import { logger } from '../utils/logger';

const log = logger.child('ScraperConfigStore');

const DATA_DIR = path.join(__dirname, '../../data');
const STORE_FILE = path.join(DATA_DIR, 'scraper_config.json');

export type ScraperSourceKey = 'sympla' | 'shotgun' | 'blacktag';

export interface ScraperSourceConfig {
    enabled: boolean;
    /** URL de listagem (cidade/filtros embutidos na própria URL). */
    url: string;
    /** Nº de páginas a paginar (só o Sympla pagina). */
    maxPages?: number;
}

export interface ScraperConfig {
    /** Liga/desliga o agendamento automático (worker periódico). */
    autoRun: boolean;
    /** De quantas em quantas horas o worker roda. */
    intervalHours: number;
    sources: Record<ScraperSourceKey, ScraperSourceConfig>;
}

export const SOURCE_KEYS: ScraperSourceKey[] = ['sympla', 'shotgun', 'blacktag'];

export const DEFAULT_SCRAPER_CONFIG: ScraperConfig = {
    autoRun: true,
    intervalHours: 6,
    sources: {
        sympla: {
            enabled: true,
            url: 'https://www.sympla.com.br/eventos/sao-paulo-sp/show-musica-festa/festas-e-baladas',
            maxPages: 3,
        },
        shotgun: { enabled: true, url: 'https://shotgun.live/en/cities/sao-paulo' },
        blacktag: { enabled: true, url: 'https://blacktag.com.br/eventos?cidade=S%C3%A3o+Paulo' },
    },
};

/** Patch parcial aceito pelo updateConfig (todos os campos opcionais). */
export interface ScraperConfigPatch {
    autoRun?: boolean;
    intervalHours?: number;
    sources?: Partial<Record<ScraperSourceKey, Partial<ScraperSourceConfig>>>;
}

const clampInterval = (h: number): number => Math.min(168, Math.max(1, Math.round(h)));
const clampPages = (p: number): number => Math.min(10, Math.max(1, Math.round(p)));

/**
 * Config dos scrapers do CentroVibe (mesmo padrão dos outros stores: JSON em data/
 * + escrita atômica). Permite ligar/desligar cada fonte, ajustar o intervalo/auto-run
 * e editar a URL-alvo (cidade/filtros) de cada fonte sem mexer em código. (#196)
 */
class ScraperConfigStore {
    private data: ScraperConfig = structuredClone(DEFAULT_SCRAPER_CONFIG);

    constructor() {
        this.load();
    }

    private load() {
        if (!fs.existsSync(STORE_FILE)) return;
        try {
            const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
            this.data = this.mergeWithDefaults(raw);
        } catch (e) {
            log.error('Falha ao carregar scraper_config.json — usando defaults', e);
            this.data = structuredClone(DEFAULT_SCRAPER_CONFIG);
        }
    }

    /** Mescla um objeto cru (de arquivo ou patch) sobre os defaults, validando/clampando. */
    private mergeWithDefaults(raw: any): ScraperConfig {
        const base = structuredClone(DEFAULT_SCRAPER_CONFIG);
        if (raw && typeof raw === 'object') {
            if (typeof raw.autoRun === 'boolean') base.autoRun = raw.autoRun;
            if (typeof raw.intervalHours === 'number') base.intervalHours = clampInterval(raw.intervalHours);
            if (raw.sources && typeof raw.sources === 'object') {
                for (const key of SOURCE_KEYS) {
                    const s = raw.sources[key];
                    if (!s || typeof s !== 'object') continue;
                    if (typeof s.enabled === 'boolean') base.sources[key].enabled = s.enabled;
                    if (typeof s.url === 'string' && /^https?:\/\//i.test(s.url)) base.sources[key].url = s.url;
                    if (typeof s.maxPages === 'number') base.sources[key].maxPages = clampPages(s.maxPages);
                }
            }
        }
        return base;
    }

    private save() {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        atomicWriteSync(STORE_FILE, this.data);
    }

    getConfig(): ScraperConfig {
        return structuredClone(this.data);
    }

    /** Aplica um patch parcial (validado/clampado), persiste e devolve a config final. */
    updateConfig(patch: ScraperConfigPatch): ScraperConfig {
        // mergeWithDefaults parte sempre dos defaults; para preservar o estado atual,
        // mesclamos o patch sobre o estado corrente antes de validar.
        const merged: any = structuredClone(this.data);
        if (patch.autoRun !== undefined) merged.autoRun = patch.autoRun;
        if (patch.intervalHours !== undefined) merged.intervalHours = patch.intervalHours;
        if (patch.sources) {
            for (const key of SOURCE_KEYS) {
                const s = patch.sources[key];
                if (!s) continue;
                merged.sources[key] = { ...merged.sources[key], ...s };
            }
        }
        this.data = this.mergeWithDefaults(merged);
        this.save();
        log.info(`Config dos scrapers atualizada (autoRun=${this.data.autoRun}, intervalo=${this.data.intervalHours}h)`);
        return this.getConfig();
    }
}

export const scraperConfigStore = new ScraperConfigStore();
