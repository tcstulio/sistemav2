// Verificação descartável da persistência das proto-sessões.
import fs from 'fs';
import path from 'path';
import { createProtoSession, getProtoSession } from '../services/protoSession';

const tok = createProtoSession('teste_persist', 'fake_key_123', { id: 99, login: 'teste_persist' });
const got = getProtoSession(tok);
const p = path.join(__dirname, '../../data/proto_sessions.json');
const onDisk = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : {};

console.log('PROTO_TEST ' + JSON.stringify({
    recuperou: got?.login,
    key: got?.dolapikey,
    arquivoExiste: fs.existsSync(p),
    tokensNoDisco: Object.keys(onDisk).length,
    tokenPresente: !!onDisk[tok],
}));
process.exit(0);
