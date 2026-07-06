import { exec, execFile } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Retorna o número de BYTES livres no dispositivo que hospeda `targetPath`.
 * Cross-platform: PowerShell (Get-PSDrive) no Windows, `df` no Unix/Mac.
 * Best-effort: resolve `null` se não conseguir medir (não lança) — quem chama
 * decide se bloqueia; em geral deve PROSSEGUIR quando indisponível, para não
 * travar o robô por falha da própria medição.
 */
export async function getFreeDiskBytes(targetPath: string): Promise<number | null> {
    try {
        if (process.platform === 'win32') {
            const drive = extractWindowsDrive(targetPath);
            if (!drive) return null;
            // Get-PSDrive: .Free é o espaço livre em bytes do volume do drive.
            const { stdout } = await execAsync(
                `powershell -NoProfile -NonInteractive -Command "(Get-PSDrive -Name '${drive}').Free"`,
                { windowsHide: true, timeout: 15000 },
            );
            const bytes = parseNumber(stdout);
            return bytes;
        }
        // Unix/Mac: 4ª coluna de `df -kP` = blocos de 1K disponíveis.
        const { stdout } = await execFileAsync('df', ['-kP', targetPath], { timeout: 15000 });
        const lines = stdout.trim().split('\n');
        if (lines.length < 2) return null;
        const parts = lines[lines.length - 1].trim().split(/\s+/);
        const availKb = parseNumber(parts[3]);
        return availKb === null ? null : availKb * 1024;
    } catch {
        return null;
    }
}

/** Extrai a letra do drive (ex.: 'C') de um path Windows como 'C:\\Projetos\\...'. */
function extractWindowsDrive(targetPath: string): string | null {
    const m = /^([a-zA-Z]):[\\/]/.exec(targetPath);
    return m ? m[1].toUpperCase() : null;
}

/** Converte a 1ª sequência numérica da saída em inteiro (bytes); null se não houver. */
function parseNumber(raw: string): number | null {
    const m = /\d+/.exec(raw.replace(/[.,\s]/g, ''));
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Formata bytes em GB com 2 casas (p/ mensagens de erro/log legíveis). */
export function formatGB(bytes: number): string {
    return (bytes / (1024 * 1024 * 1024)).toFixed(2);
}
