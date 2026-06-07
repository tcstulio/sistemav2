// PROTÓTIPO (Desenho B) — cofre de sessões em memória.
// O navegador recebe SÓ um token de sessão opaco (inofensivo). O backend mapeia
// esse token -> usuário, e o middleware troca pela CHAVE DE SERVIÇO (admin) ao
// falar com o Dolibarr. A chave admin NUNCA chega ao navegador.
import { randomBytes } from 'crypto';

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
    return token;
}

export function getProtoSession(token: string): ProtoSession | null {
    if (!token || !token.startsWith('sess_')) return null; // não é sessão -> deixa o fluxo legado seguir
    const s = sessions.get(token);
    if (!s) return null;
    if (Date.now() - s.createdAt > TTL_MS) {
        sessions.delete(token);
        return null;
    }
    return s;
}
