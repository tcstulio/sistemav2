// Gera um PRINT-GUIA anotado de uma tela (dado de EXEMPLO + botão-alvo destacado).
//
// CI-pure: stuba TODA a rede /api + semeia a sessão → NÃO precisa de credencial nem Dolibarr real
// (o mesmo motor do harness de render). Precisa apenas do frontend servido em :3003 (GUIDE_BASE_URL).
//
// Uso:  npx tsx backend/scripts/generate-guide.ts
//
// É o "core" do guia visual no chat (#1050): o gerador reutilizável. A fiação no chat/agente (tool
// que devolve imagem + deeplink personalizado por papel) é follow-up.
import { guideService } from '../src/services/guideService';

(async () => {
    const out = await guideService.generateScreenGuide({
        path: '/customers',
        targetText: 'Novo',
        callout: '① Clique aqui para cadastrar um cliente',
        label: 'guia-novo-cliente',
        fixtures: {
            // dado de EXEMPLO (sem PII) — a tela renderiza limpa e clara para o tutorial.
            thirdparties: [
                { id: '101', name: 'ACME Comércio Ltda', code_client: 'CU-0001', town: 'São Paulo', client: '1', status: '1', email: 'contato@acme.com.br', tms: 1750000000, datec: 1700000000, fournisseur: '0' },
                { id: '102', name: 'Beta Serviços ME', code_client: 'CU-0002', town: 'Rio de Janeiro', client: '1', status: '1', email: 'fin@beta.com.br', tms: 1750000100, datec: 1700000100, fournisseur: '0' },
            ],
        },
    });
    console.log('Guia gerado:', out);
})().catch((e) => { console.error('ERRO:', e?.message || e); process.exit(1); });
