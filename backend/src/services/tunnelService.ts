// Gerencia um quick tunnel do cloudflared automaticamente:
// - sobe junto com o backend (se CLOUDFLARE_TUNNEL_ENABLED=true)
// - captura a URL pública (trycloudflare.com muda a cada restart)
// - reinicia sozinho se o processo cair (a URL muda — getUrl reflete a atual)
// - usa um config VAZIO para nao herdar ~/.cloudflared/config.yml (ingress 404)
import { spawn, ChildProcess } from 'child_process';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { logger } from '../utils/logger';

const log = logger.child('TunnelService');

const TARGET = process.env.CLOUDFLARE_TUNNEL_TARGET || 'http://127.0.0.1:3003';

let currentUrl: string | null = null;
let updatedAt: number | null = null;
let proc: ChildProcess | null = null;
let restartTimer: NodeJS.Timeout | null = null;
let stopped = false;

function emptyConfigPath(): string {
    const p = join(tmpdir(), 'coolgroove-cf-quick.yml');
    try { writeFileSync(p, '# empty config -> quick tunnel limpo (ignora ingress global)\n'); } catch { /* ignore */ }
    return p;
}

// Notifica o owner por e-mail quando o endereço público muda.
// Config: TUNNEL_NOTIFY_EMAIL (destinatário) e, opcional, TUNNEL_NOTIFY_EMAIL_ACCOUNT (id da conta SMTP).
async function notifyByEmail(url: string) {
    const to = process.env.TUNNEL_NOTIFY_EMAIL;
    if (!to) return;
    try {
        const { emailService } = require('./emailService');
        const { emailStoreService } = require('./emailStoreService');
        const accounts = emailStoreService.getAllAccounts();
        const account = accounts.find((a: any) => a.id === process.env.TUNNEL_NOTIFY_EMAIL_ACCOUNT) || accounts[0];
        if (!account) { log.warn('Notificação de URL: nenhuma conta SMTP cadastrada.'); return; }
        const html = `<p>O sistema está acessível em:</p>
            <p style="font-size:16px"><a href="${url}">${url}</a></p>
            <p style="color:#888;font-size:12px">Endereço gerado pelo cloudflared — muda a cada reinício.</p>`;
        await emailService.sendEmail(account.id, to, 'Novo endereço de acesso ao sistema', html);
        log.info(`URL do túnel enviada por e-mail para ${to} (via ${account.email}).`);
    } catch (e: any) {
        log.error(`Falha ao notificar URL por e-mail: ${e.message}`);
    }
}

function spawnTunnel() {
    if (proc || stopped) return;
    const cfg = emptyConfigPath();
    log.info(`Iniciando cloudflared quick tunnel -> ${TARGET}`);
    try {
        proc = spawn('cloudflared', ['tunnel', '--config', cfg, '--url', TARGET], { windowsHide: true });
    } catch (e: any) {
        log.error(`Falha ao iniciar cloudflared (instalado?): ${e.message}`);
        return;
    }

    const onData = (buf: Buffer) => {
        const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (m && m[0] !== currentUrl) {
            currentUrl = m[0];
            updatedAt = Date.now();
            log.info(`Tunnel URL pública: ${currentUrl}`);
            void notifyByEmail(currentUrl);
        }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData); // cloudflared imprime a URL no stderr

    proc.on('exit', (code) => {
        log.warn(`cloudflared encerrou (code ${code}).`);
        proc = null;
        currentUrl = null;
        updatedAt = null;
        if (!stopped) {
            if (restartTimer) clearTimeout(restartTimer);
            restartTimer = setTimeout(spawnTunnel, 5000);
        }
    });
}

export const tunnelService = {
    start: () => {
        if (process.env.CLOUDFLARE_TUNNEL_ENABLED !== 'true') {
            log.info('Cloudflare tunnel desligado (CLOUDFLARE_TUNNEL_ENABLED!=true).');
            return;
        }
        stopped = false;
        spawnTunnel();
    },
    stop: () => {
        stopped = true;
        if (restartTimer) clearTimeout(restartTimer);
        if (proc) { proc.kill(); proc = null; }
    },
    getUrl: () => currentUrl,
    getStatus: () => ({ url: currentUrl, updatedAt, running: !!proc }),
};
