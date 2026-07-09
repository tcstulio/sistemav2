import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// === Mocks (hoisted) — espelham as deps externas do taskRunnerService (padrão do queue/gate test). ===
vi.mock('child_process', () => ({ execFile: vi.fn(), exec: vi.fn(), spawn: vi.fn() }));
vi.mock('../../utils/atomicWrite', () => ({ atomicWriteSync: vi.fn() }));
vi.mock('../../services/socketService', () => ({ socketService: { emit: vi.fn() } }));
vi.mock('../../services/aiService', () => ({ aiService: { generateReply: vi.fn() } }));
vi.mock('../../services/aiJobService', () => ({ aiJobService: { runAndWait: vi.fn() } }));
vi.mock('../../utils/previewPorts', () => ({ previewPortsFor: vi.fn(() => ({ frontendPort: 5999, backendPort: 6000 })) }));
vi.mock('../../services/screenshotService', () => ({ screenshotService: { captureForTask: vi.fn() } }));
vi.mock('../../services/taskUsageTracker', () => ({ recordUsage: vi.fn(), getUsageForTask: vi.fn(() => null) }));
vi.mock('../../utils/processTree', () => ({
    killTree: vi.fn(async () => ({ ok: true })), isAlive: vi.fn(() => false),
    killOpencodeOrphans: vi.fn(async () => ({ killed: [], errors: [], confirmedGone: true, discriminated: true })),
    killByImageName: vi.fn(async () => undefined), listPidsByName: vi.fn(async () => []),
}));
vi.mock('../../utils/runOpencode', () => ({ runOpencode: vi.fn(), resolveBash: vi.fn(() => 'bash') }));
vi.mock('../../services/taskPlannerService', () => ({
    taskPlannerService: { analyzeTask: vi.fn(), skipAndClose: vi.fn(), decomposeEpic: vi.fn(), reevaluateWaiting: vi.fn(async () => []) },
}));
vi.mock('../../services/uiConfigService', () => ({ uiConfigService: { get: vi.fn() } }));
vi.mock('../../services/notificationService', () => ({ notificationService: { create: vi.fn(async () => ({})) } }));

// axios: mockado p/ inspecionar os HEADERS enviados no download de imagem (teste de segurança).
// vi.hoisted p/ a fn existir ANTES do vi.mock hoisteado (senão "cannot access before initialization").
const { axiosGet } = vi.hoisted(() => ({ axiosGet: vi.fn(async () => ({ data: Buffer.from('img') })) }));
vi.mock('axios', () => ({ default: { get: axiosGet }, get: axiosGet }));

import { taskRunnerService, MAX_TASK_WALL_MS } from '../../services/taskRunnerService';
const svc = taskRunnerService as any;

// Espelha o watchdog de aquisição do withWorktreeLock (taskRunnerService.ts: `MAX_TASK_WALL_MS + 5min`).
// Reaproveitar a constante de produção (e não rederivar de process.env) elimina flakiness entre suites
// e garante que o teste dispare o timer no mesmo piso que o código real.
const WORKTREE_LOCK_WATCHDOG_MS = MAX_TASK_WALL_MS + 5 * 60_000;

describe('#1154 P0-1 — segurança: token do GitHub só p/ hosts confiáveis (anti-exfiltração)', () => {
    beforeEach(() => { axiosGet.mockClear(); axiosGet.mockResolvedValue({ data: Buffer.from('img') }); });

    it('NÃO envia Authorization p/ host de ATACANTE (evil.com), mesmo com .png', async () => {
        await svc.downloadImageBase64('https://evil.com/steal.png');
        expect(axiosGet).toHaveBeenCalled();
        for (const call of axiosGet.mock.calls) {
            const headers = call[1]?.headers || {};
            expect(headers.Authorization).toBeUndefined(); // token NUNCA vaza p/ terceiros
        }
    });

    it('host confiável (user-attachments) reconhecido como GitHub', () => {
        const isTrusted = (svc.constructor as any).isTrustedGithubHost;
        expect(isTrusted('https://github.com/user-attachments/assets/x.png')).toBe(true);
        expect(isTrusted('https://objects.githubusercontent.com/y.png')).toBe(true);
        expect(isTrusted('https://evil.com/a.png')).toBe(false);
        expect(isTrusted('https://evil.githubusercontent.com.attacker.net/a.png')).toBe(false); // não casa por substring
        expect(isTrusted('não-é-url')).toBe(false);
    });
});

describe('#1154 P0-2 — timer-bomba do worktreeLock: caminho FELIZ não dispara efeitos colaterais', () => {
    beforeEach(() => {
        svc.stopPolling?.();
        svc.worktreeLock = Promise.resolve();
        svc.store = { tasks: {} };
        svc.sweepOrphanedOpencode = vi.fn(async () => false);
        svc.cleanStaleLocks = vi.fn();
        svc.save = vi.fn();
        svc.recordEvent = vi.fn();
        svc.emitStatus = vi.fn();
        vi.useFakeTimers();
        vi.clearAllTimers();
    });
    afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

    it('aquisição bem-sucedida CANCELA o watchdog — avançar 4h NÃO mata opencode nem falha task', async () => {
        // Semeia uma task inocente "running" que o timer-bomba (antes do fix) marcaria como failed.
        svc.store.tasks = { 42: { issueNumber: 42, status: 'running' } };

        // Aquisição no caminho FELIZ (prev já resolvido) — roda o fn e libera.
        await svc.withWorktreeLock('exec #42', async () => 'ok');

        // Avança MUITO além do watchdog (3h05). Sem o clearTimeout, o setTimeout dispararia AQUI.
        await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);

        // Efeitos colaterais do timer NÃO podem ter rodado no caminho feliz:
        expect(svc.sweepOrphanedOpencode).not.toHaveBeenCalled();
        expect(svc.store.tasks[42].status).toBe('running'); // task inocente intacta (não virou failed)
    });
});

describe('#1114 — worktreeLock: timeout na aquisição NÃO envenena a cadeia (auto-cura)', () => {
    beforeEach(() => {
        svc.stopPolling?.();
        svc.store = { tasks: {} };
        svc.sweepOrphanedOpencode = vi.fn(async () => false);
        svc.cleanStaleLocks = vi.fn();
        svc.save = vi.fn();
        svc.recordEvent = vi.fn();
        svc.emitStatus = vi.fn();
        vi.useFakeTimers();
        vi.clearAllTimers();
    });
    afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

    it('holder pendurado → a próxima aquisição falha no watchdog MAS a seguinte se recupera', async () => {
        // Simula o incidente 2026-07-06: um holder de um run anterior morreu/restartou SEM chamar
        // release() (ex.: entre o `prev = this.worktreeLock` e o `release()` do finally). Resultado:
        // `this.worktreeLock` ficou apontando p/ uma promise que NUNCA resolve. Antes do fix #1114,
        // a aquisição abaixo rejeitaria SEM chamar release() → TODA task seguinte também daria
        // timeout (a CASCATA que travou o robô por ~3h). O catch do fix libera o elo → auto-cura.
        svc.worktreeLock = new Promise<void>(() => {});
        // Task "running" que o watchdog (ao disparar) marcará failed — confirma que o caminho de timeout rodou.
        svc.store.tasks = { 42: { issueNumber: 42, status: 'running' } };

        // Aquisição B aguarda o holder morto → só resta o watchdog, que rejeita. O `.catch` anexado
        // ANTES do disparo do timer evita unhandled-rejection spurious e captura o erro p/ asserção.
        const failing = svc.withWorktreeLock('exec #42', async () => 'nunca-chega-a-rodar');
        const failingAssertion = expect(failing).rejects.toThrow(/worktreeLock timeout/);
        // Avança ALÉM do watchdog total — o suficiente p/ a Promise.race rejeitar no timer.
        await vi.advanceTimersByTimeAsync(WORKTREE_LOCK_WATCHDOG_MS + 60_000);
        await failingAssertion;
        // Efeito colateral esperado do watchdog: a task inocente foi marcada failed.
        expect(svc.store.tasks[42].status).toBe('failed');

        // CRÍTICO #1114 / CRITÉRIO DE ACEITE: o catch do timeout chamou release() → o elo QUE B CRIOU
        // está resolvido → this.worktreeLock deixou de apontar p/ a promise morta. A aquisição C
        // (prev já resolvido) adquire imediatamente, roda o fn e retorna — a cadeia se auto-curou.
        const recovered = await svc.withWorktreeLock('exec #43', async () => 'cadeia-recuperada');
        expect(recovered).toBe('cadeia-recuperada');
    });

    it('cadeia N>2: holder pendurado faz APENAS a 1ª aquisição falhar — as demais se recuperam em série', async () => {
        // Múltiplos waiters encadeados no momento do timeout (gap apontado na revisão #1114).
        // Antes do fix, o elo quebrado envenenaria TODA a fila; com o release() no catch, só a aquisição
        // que bateu de frente com o holder morto rejeita — o 1º release de auto-cura destrava a próxima,
        // que roda e libera, destravando a seguinte, e assim por diante (auto-cura em cascata inversa).
        svc.worktreeLock = new Promise<void>(() => {}); // holder morto

        // Três aquisições disparadas em sequência (síncrono até o 1º await interno): cada uma captura
        // o elo da anterior como `prev`. A aguarda P_dead → B aguarda el_A → C aguarda el_B.
        const A = svc.withWorktreeLock('A', async () => 'A-ok');
        const B = svc.withWorktreeLock('B', async () => 'B-ok');
        const C = svc.withWorktreeLock('C', async () => 'C-ok');
        // Handler de rejeição anexado ANTES do disparo do timer (evita unhandled-rejection spurious).
        const Aerr = A.catch((e: unknown) => e);

        // Watchdog da 1ª aquisição dispara: reject → catch → release(el_A) → el_A resolve → throw.
        // Como el_A resolveu, a race de B vence pelo `prev` (antes do próprio watchdog de B) → B roda o
        // fn e libera el_B → C vence pelo `prev` → roda e libera el_C. (Os watchdogs de B/C são cancelados
        // no finally de cada uma.) Resultado: só A falha; B e C concluem — a fila inteira se recupera.
        await vi.advanceTimersByTimeAsync(WORKTREE_LOCK_WATCHDOG_MS + 60_000);

        const aErr = await Aerr;
        expect(aErr).toBeInstanceOf(Error);
        expect(String((aErr as Error).message)).toMatch(/worktreeLock timeout/);

        // B e C NÃO herdam o elo quebrado — a cadeia se auto-curou por completo (não só a próxima).
        await expect(B).resolves.toBe('B-ok');
        await expect(C).resolves.toBe('C-ok');
    });

    it('holder que libera TARDIAMENTE (após o watchdog disparar) NÃO corrompe a cadeia já curada', async () => {
        // Gap apontado na revisão #1114: race entre release tardio do holder original e a próxima aquisição.
        // O holder não morreu — apenas estava LENTO. Seu release() enfim roda DEPOIS do watchdog já ter
        // abortado a aquisição A. Como a Promise.race de A já estava settled (rejeitada pelo timer), o
        // resolve tardio do holder é um no-op; e o elo de auto-cura que A criou continua resolvido.
        let releaseHolder!: () => void;
        const slowHolder = new Promise<void>((r) => { releaseHolder = r; });
        svc.worktreeLock = slowHolder;

        const A = svc.withWorktreeLock('A', async () => 'A-ok');
        const Aerr = A.catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(WORKTREE_LOCK_WATCHDOG_MS + 60_000); // watchdog dispara
        const aErr = await Aerr;
        expect(String((aErr as Error).message)).toMatch(/worktreeLock timeout/);

        // Agora o holder lento finalmente libera — DEPOIS do aborto. Não deve reassentar nada nem reviver A.
        releaseHolder();
        await Promise.resolve(); // flush de microtasks do resolve tardio

        // A cadeia permanece curada: a próxima aquisição adquire normalmente (prev = elo de A, resolvido).
        const recovered = await svc.withWorktreeLock('B', async () => 'B-recuperado');
        expect(recovered).toBe('B-recuperado');
    });
});
