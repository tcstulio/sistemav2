/**
 * Patch durável do whatsapp-web.js (roda no postinstall).
 *
 * Contexto: a versão nova do WhatsApp Web passou a devolver WIDs minificados onde
 * `_serialized` não existe e o valor fica na propriedade `$1`. Sem o fallback, o store
 * carrega mas getChats/getMessages quebram e nenhuma conversa aparece (2026-07-15).
 *
 * Dois alvos:
 *  1) src/util/Injected/Utils.js — 6 pontos (getChats/getMessages, 2026-07-15).
 *  2) src/structures/Message.js — o `downloadMedia()` (e os demais evaluate por id)
 *     passavam `this.id._serialized` (UNDEFINED p/ @lid) ao navegador → `resolveMediaBlob`
 *     falhava e NENHUMA mídia recebida (imagem/áudio/PDF) baixava (2026-07-28). O fallback
 *     `|| this.id.$1` usa o mesmo id serializado que o getMessages já usa.
 *
 * Idempotente: pode rodar quantas vezes for; falha ALTO se a estrutura mudar (ex.: bump do
 * wwebjs) — nesse caso, regenerar os pares abaixo contra a versão nova.
 */
const fs = require('fs');
const path = require('path');

const EXPECTED_VERSION = '1.34.7';
const PKG_DIR = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js');

// [original exato, versão patchada] — substituição por string literal (split/join),
// nunca regex com $1 no replacement (foi exatamente esse escaping que quebrou antes).
const FILES = [
    {
        target: path.join(PKG_DIR, 'src', 'util', 'Injected', 'Utils.js'),
        replacements: [
            ['.Msg.get(newMsgKey._serialized);',
                '.Msg.get((newMsgKey._serialized || newMsgKey.$1));'],
            ['.Msg.get(msg.id._serialized);',
                '.Msg.get((msg.id._serialized || msg.id.$1));'],
            ['remote: msg.id.remote._serialized,',
                'remote: (msg.id.remote._serialized || msg.id.remote.$1),'],
            ['.createWid(chat.id._serialized);',
                '.createWid((chat.id._serialized || chat.id.$1));'],
            ['.Msg.get(chat.lastReceivedKey._serialized) ||',
                '.Msg.get((chat.lastReceivedKey._serialized || chat.lastReceivedKey.$1)) ||'],
            ['chat.lastReceivedKey._serialized,',
                '(chat.lastReceivedKey._serialized || chat.lastReceivedKey.$1),'],
        ],
    },
    {
        // downloadMedia() e os demais pupPage.evaluate(fn, this.id._serialized) do Message.js:
        // p/ @lid o _serialized é undefined → o navegador não resolve a mídia ("r"). Todas as
        // chamadas de arg-único terminam com "}, this.id._serialized);" — o fallback vale p/ todas.
        target: path.join(PKG_DIR, 'src', 'structures', 'Message.js'),
        replacements: [
            ['}, this.id._serialized);',
                '}, (this.id._serialized || this.id.$1));'],
        ],
    },
];

function fail(msg) {
    console.error(`[apply-wwebjs-patch] ERRO: ${msg}`);
    console.error('[apply-wwebjs-patch] O WhatsApp NÃO vai listar conversas / baixar mídia sem este patch. Regenere os pares em scripts/apply-wwebjs-patch.js contra a versão instalada.');
    process.exit(1);
}

const installedVersion = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8')).version;
if (installedVersion !== EXPECTED_VERSION) {
    fail(`whatsapp-web.js ${installedVersion} instalado, patch foi feito para ${EXPECTED_VERSION}.`);
}

let totalApplied = 0;
let totalAlready = 0;

for (const { target, replacements } of FILES) {
    let content = fs.readFileSync(target, 'utf8');
    let applied = 0;

    for (const [pristine, patched] of replacements) {
        if (content.includes(patched)) {
            totalAlready++;
        } else if (content.includes(pristine)) {
            content = content.split(pristine).join(patched);
            applied++;
        } else {
            fail(`trecho não encontrado (nem original nem patchado) em ${path.basename(target)}: ${pristine}`);
        }
    }

    if (applied > 0) {
        fs.writeFileSync(target, content);
    }
    totalApplied += applied;
}

console.log(`[apply-wwebjs-patch] OK: ${totalApplied} aplicado(s), ${totalAlready} já patchado(s).`);
