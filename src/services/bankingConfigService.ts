import axios from 'axios';
import { safeStorage } from '../utils/safeStorage';

// Endpoint admin-only (#45). Auth no padrão das telas admin (uiConfigService): Bearer apiKey.
const API_URL = '/api/banking/credentials';

const getAuthHeaders = () => {
    const cfg = safeStorage.getJSON<Record<string, any>>('coolgroove_config', {});
    return { headers: { Authorization: 'Bearer ' + (cfg.apiKey || '') } };
};

export type BankId = 'inter' | 'itau';

export interface BankCredStatus {
    configured: boolean;
    hasClientId: boolean;
    hasClientSecret: boolean;
    environment: 'sandbox' | 'production';
    contaCorrente?: boolean;
    agencia?: boolean;
    updatedAt?: string;
}

export interface SaveBankingCredentialsBody {
    clientId?: string;
    clientSecret?: string; // omitir/vazio preserva o secret já salvo
    environment: 'sandbox' | 'production';
    contaCorrente?: string;
    agencia?: string;
}

/** Salva as credenciais (o secret é cifrado no backend). Retorna só flags de status. */
export async function saveBankingCredentials(bank: BankId, body: SaveBankingCredentialsBody): Promise<BankCredStatus> {
    const { data } = await axios.post(API_URL, { bank, ...body }, getAuthHeaders());
    return data as BankCredStatus;
}

/** Status (só flags — nunca o secret). */
export async function getBankingCredentialsStatus(bank: BankId): Promise<BankCredStatus> {
    const { data } = await axios.get(`${API_URL}/status`, { params: { bank }, ...getAuthHeaders() });
    return data as BankCredStatus;
}

/** Remove as credenciais de um banco (volta ao fallback do .env). */
export async function deleteBankingCredentials(bank: BankId): Promise<BankCredStatus> {
    const { data } = await axios.delete(`${API_URL}/${bank}`, getAuthHeaders());
    return data as BankCredStatus;
}
