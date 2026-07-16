/**
 * Patch durável do whatsapp-web.js (roda no postinstall).
 *
 * Contexto: a versão nova do WhatsApp Web passou a devolver WIDs minificados onde
 * `_serialized` não existe e o valor fica na propriedade `$1`. Sem o fallback, o store
 * carrega mas getChats/getMessages quebram e nenhuma conversa aparece (2026-07-15).
 *
 * O patch adiciona `|| X.$1` como fallback em 6 pontos de src/util/Injected/Utils.js.
 * Idempotente: pode rodar quantas vezes for; falha ALTO se a estrutura do arquivo mudar
 * (ex.: bump do wwebjs) — nesse caso, regenerar os pares abaixo contra a versão nova.
 */
const fs = require('fs');
const path = require('path');

const EXPECTED_VERSION = '1.34.7';
const PKG_DIR = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js');
const TARGET = path.join(PKG_DIR, 'src', 'util', 'Injected', 'Utils.js');

// [original exato, versão patchada] — substituição por string literal (split/join),
// nunca regex com $1 no replacement (foi exatamente esse escaping que quebrou antes).
const REPLACEMENTS = [
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
];

function fail(msg) {
    console.error(`[apply-wwebjs-patch] ERRO: ${msg}`);
    console.error('[apply-wwebjs-patch] O WhatsApp NÃO vai listar conversas sem este patch. Regenere os pares em scripts/apply-wwebjs-patch.js contra a versão instalada.');
    process.exit(1);
}

const installedVersion = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8')).version;
if (installedVersion !== EXPECTED_VERSION) {
    fail(`whatsapp-web.js ${installedVersion} instalado, patch foi feito para ${EXPECTED_VERSION}.`);
}

let content = fs.readFileSync(TARGET, 'utf8');
let applied = 0;
let alreadyPatched = 0;

for (const [pristine, patched] of REPLACEMENTS) {
    if (content.includes(patched)) {
        alreadyPatched++;
    } else if (content.includes(pristine)) {
        content = content.split(pristine).join(patched);
        applied++;
    } else {
        fail(`trecho não encontrado (nem original nem patchado): ${pristine}`);
    }
}

if (applied > 0) {
    fs.writeFileSync(TARGET, content);
}
console.log(`[apply-wwebjs-patch] OK: ${applied} aplicado(s), ${alreadyPatched} já patchado(s).`);
