import fs from 'fs';
import path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';
import { encrypt, decrypt, isEncrypted } from '../utils/crypto';
import { logger } from '../utils/logger';

const log = logger.child('BankingCredentialsStore');

const DATA_DIR = path.join(__dirname, '../../data');
const STORE_FILE = path.join(DATA_DIR, 'banking_credentials.json');

export type BankId = 'inter' | 'itau';

export interface BankCreds {
    clientId?: string;
    clientSecret?: string;   // persistido SEMPRE cifrado ("enc:...")
    sandbox?: boolean;
    contaCorrente?: string;  // Itaú
    agencia?: string;        // Itaú
    updatedAt?: string;
    updatedBy?: string;
}

export interface BankCredsStatus {
    configured: boolean;
    hasClientId: boolean;
    hasClientSecret: boolean;
    environment: 'sandbox' | 'production';
    contaCorrente?: boolean;
    agencia?: boolean;
    updatedAt?: string;
}

type CredentialsFile = { inter?: BankCreds; itau?: BankCreds };

/**
 * Store seguro das credenciais bancárias (Inter/Itaú), no mesmo padrão do emailStoreService:
 * JSON em data/ + escrita atômica + cripto AES-256-GCM (crypto.ts) só no clientSecret. Sem banco.
 *
 * Contrato de segurança: o clientSecret é decifrado apenas para uso INTERNO dos services
 * (getClientSecret). getStatus() devolve só flags booleanas — nenhuma rota expõe o secret. (#45)
 */
class BankingCredentialsStore {
    private data: CredentialsFile = {};

    constructor() {
        this.load();
    }

    private load() {
        if (fs.existsSync(STORE_FILE)) {
            try {
                this.data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
            } catch (e) {
                log.error('Failed to load banking credentials', e);
                this.data = {};
            }
            this.migrateSecrets();
        }
    }

    /** Cifra qualquer clientSecret em claro encontrado na primeira carga (defensivo). */
    private migrateSecrets() {
        let migrated = false;
        for (const bank of ['inter', 'itau'] as BankId[]) {
            const c = this.data[bank];
            if (c?.clientSecret && !isEncrypted(c.clientSecret)) {
                c.clientSecret = encrypt(c.clientSecret);
                migrated = true;
            }
        }
        if (migrated) {
            this.save();
            log.info('Migrated banking client secrets — now encrypted');
        }
    }

    private save() {
        // Cria o diretório lazimente (no 1º write), evitando efeito colateral de fs no import.
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        atomicWriteSync(STORE_FILE, this.data);
    }

    /**
     * Atualiza as credenciais de um banco. O clientSecret é cifrado antes de persistir.
     * Se patch.clientSecret vier vazio/ausente, o secret existente é PRESERVADO — permite
     * salvar só clientId/ambiente/conta sem reenviar o secret.
     */
    setCredentials(bank: BankId, patch: Partial<BankCreds>, updatedBy?: string): void {
        const merged: BankCreds = { ...(this.data[bank] || {}) };

        if (patch.clientId !== undefined) merged.clientId = patch.clientId;
        if (patch.sandbox !== undefined) merged.sandbox = patch.sandbox;
        if (patch.contaCorrente !== undefined) merged.contaCorrente = patch.contaCorrente;
        if (patch.agencia !== undefined) merged.agencia = patch.agencia;
        if (patch.clientSecret) {
            merged.clientSecret = isEncrypted(patch.clientSecret) ? patch.clientSecret : encrypt(patch.clientSecret);
        }

        merged.updatedAt = new Date().toISOString();
        if (updatedBy) merged.updatedBy = updatedBy;

        this.data[bank] = merged;
        this.save();
    }

    getClientId(bank: BankId): string | undefined {
        return this.data[bank]?.clientId || undefined;
    }

    /** DECIFRA o secret. USO INTERNO/serviço apenas — nunca exposto por rota. */
    getClientSecret(bank: BankId): string | undefined {
        const enc = this.data[bank]?.clientSecret;
        if (!enc) return undefined;
        try {
            return decrypt(enc);
        } catch (e) {
            log.error(`Falha ao decifrar clientSecret de ${bank}`, e);
            return undefined;
        }
    }

    getSandbox(bank: BankId): boolean | undefined {
        return this.data[bank]?.sandbox;
    }

    getContaCorrente(bank: BankId): string | undefined {
        return this.data[bank]?.contaCorrente || undefined;
    }

    getAgencia(bank: BankId): string | undefined {
        return this.data[bank]?.agencia || undefined;
    }

    /** Retorna SÓ flags — jamais o secret ou valores sensíveis. */
    getStatus(bank: BankId): BankCredsStatus {
        const c = this.data[bank];
        return {
            configured: !!(c?.clientId && c?.clientSecret),
            hasClientId: !!c?.clientId,
            hasClientSecret: !!c?.clientSecret,
            environment: c?.sandbox ? 'sandbox' : 'production',
            contaCorrente: c?.contaCorrente ? true : undefined,
            agencia: c?.agencia ? true : undefined,
            updatedAt: c?.updatedAt,
        };
    }

    clearCredentials(bank: BankId): void {
        delete this.data[bank];
        this.save();
    }
}

export const bankingCredentialsStore = new BankingCredentialsStore();
