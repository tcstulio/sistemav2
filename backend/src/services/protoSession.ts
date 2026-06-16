// PROTÓTIPO (Desenho B) — cofre de sessões.
// O navegador recebe SÓ um token de sessão opaco (inofensivo). O backend mapeia
// esse token -> usuário, e o middleware troca pela CHAVE DE SERVIÇO (admin) ao
// falar com o Dolibarr. A chave admin NUNCA chega ao navegador.
//
// PERSISTÊNCIA: o mapa é gravado em data/proto_sessions.json (atômico) e recarregado no boot,
// para que um restart do backend (nodemon/deploy) NÃO deslogue todo mundo. O arquivo contém a
// DOLAPIKEY real (server-side, nunca vai ao navegador) e fica em backend/data/ (gitignored).
// SEGURANÇA: proteger o diretório data/; avaliar cifragem em repouso no futuro.
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';
import { createLogger } from '../utils/logger';

const log = createLogger('ProtoSession');
const STORE_PATH = path.join(__dirname, '../../data/proto_sessions.json');

interface ProtoSession {
    login: string;
    dolapikey: string; // DOLAPIKEY real do usuário — fica server-side, nunca vai pro navegador
    createdAt: number;
    userData?: {
        id: number;
        login: string;
        firstname?: string;
        lastname?: string;
        email?: string;
        job?: string;
        admin?: boolean;
        employee?: number;
        socid?: number;
        photo?: string;
    };
}

const sessions = new Map<string, ProtoSession>();
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

// Carrega as sessões do disco no boot (pruna as expiradas).
(function load() {
    try {
        if (!fs.existsSync(STORE_PATH)) return;
        const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8')) as Record<string, ProtoSession>;
        const now = Date.now();
        let loaded = 0;
        for (const [token, s] of Object.entries(raw || {})) {
            if (s && typeof s.createdAt === 'number' && now - s.createdAt <= TTL_MS) {
                sessions.set(token, s);
                loaded++;
            }
        }
        log.info(`Sessões restauradas do disco: ${loaded}`);
    } catch (e: any) {
        log.warn(`Falha ao carregar proto_sessions.json: ${e?.message || e}`);
    }
})();

function persist() {
    try {
        const obj: Record<string, ProtoSession> = {};
        for (const [token, s] of sessions) obj[token] = s;
        atomicWriteSync(STORE_PATH, obj);
    } catch (e: any) {
        log.warn(`Falha ao persistir proto_sessions.json: ${e?.message || e}`);
    }
}

export function createProtoSession(login: string, dolapikey: string, userData?: any): string {
    const token = 'sess_' + randomBytes(24).toString('hex');
    sessions.set(token, {
        login,
        dolapikey,
        createdAt: Date.now(),
        userData: userData ? {
            id: userData.id,
            login: userData.login || login,
            firstname: userData.firstname,
            lastname: userData.lastname,
            email: userData.email,
            job: userData.job,
            admin: userData.admin,
            employee: userData.employee,
            socid: userData.socid,
            photo: userData.photo,
        } : undefined,
    });
    persist();
    return token;
}

// Backfill/atualiza o perfil (userData) de uma sessão já existente e persiste.
// Usado pelo middleware quando a sessão é antiga/incompleta (criada antes de persistirmos
// userData, ou quando getUserByKey falhou no login) — assim o admin não fica "perdido".
export function setProtoSessionUserData(token: string, userData: any): void {
    const s = sessions.get(token);
    if (!s || !userData) return;
    s.userData = {
        id: userData.id,
        login: userData.login || s.login,
        firstname: userData.firstname,
        lastname: userData.lastname,
        email: userData.email,
        job: userData.job,
        admin: userData.admin,
        employee: userData.employee,
        socid: userData.socid,
        photo: userData.photo,
    };
    persist();
}

export function getProtoSession(token: string): ProtoSession | null {
    if (!token || !token.startsWith('sess_')) return null; // não é sessão -> deixa o fluxo legado seguir
    const s = sessions.get(token);
    if (!s) return null;
    if (Date.now() - s.createdAt > TTL_MS) {
        sessions.delete(token);
        persist();
        return null;
    }
    return s;
}
