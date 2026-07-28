import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-secret-readonly-gate' } }));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: {} }));
vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));

import { executeTool, runWithToolContext } from '../../services/agentTools';

// Regressão: um conserto externo (2026-07-15) removeu os prefixos prepare_* do isMutatingTool
// e o bot de WhatsApp (readOnly) passou a poder gerar rascunhos por ordem de QUALQUER contato.
// A trava foi restaurada; estes testes pregam o comportamento no lugar.
describe('agentTools — contexto somente-leitura bloqueia toda tool de escrita/efeito externo', () => {
    const blockedTools = [
        'prepare_create_invoice',
        'prepare_create_proposal',
        'prepare_edit_proposal',
        'validate_proposal',
        'delete_proposal',
        'send_whatsapp',
        'notify_person',
        'web_search',
    ];

    for (const tool of blockedTools) {
        it(`bloqueia ${tool}`, async () => {
            const result = await runWithToolContext({ readOnly: true }, () => executeTool(tool, {}));
            expect(result).toContain('somente leitura');
        });
    }
});
