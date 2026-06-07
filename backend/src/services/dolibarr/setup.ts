import axios from 'axios';
import { DolibarrServiceBase } from './core';
import { createLogger } from '../../utils/logger';

const log = createLogger('DolibarrSetup');

export interface CompanyInfo {
    name: string;
    email: string;
    phone: string;
    address: string;
    zip: string;
    town: string;
    country_code: string;
    idprof4: string;
    managers: string;
    url: string;
    logo: string;
    default_lang: string;
    capital: number;
    tva_assuj: boolean;
    vat_reverse_charge: boolean;
}

export class DolibarrSetupService extends DolibarrServiceBase {

    async getCompanyInfo(): Promise<CompanyInfo | null> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}setup/company`;
            const response = await axios.get(url, {
                headers,
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200,
            });

            const d = response.data;
            if (!d) return null;

            return {
                name: d.name || '',
                email: d.email || '',
                phone: d.phone || '',
                address: d.address || '',
                zip: d.zip || '',
                town: d.town || '',
                country_code: d.country_code || '',
                idprof4: d.idprof4 || '',
                managers: d.managers || '',
                url: d.url || '',
                logo: d.logo || '',
                default_lang: d.default_lang || '',
                capital: parseFloat(d.capital || '0'),
                tva_assuj: d.tva_assuj === 1 || d.tva_assuj === '1',
                vat_reverse_charge: d.vat_reverse_charge === 1 || d.vat_reverse_charge === '1',
            };
        } catch (error) {
            log.error('getCompanyInfo Error', error);
            return null;
        }
    }

    async listCurrencies(): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}currencies`;
            const response = await axios.get(url, {
                headers,
                params: { limit: 50 },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200,
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error('listCurrencies Error', error);
            return [];
        }
    }

    async listCountries(): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}countries`;
            const response = await axios.get(url, {
                headers,
                params: { limit: 100 },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200,
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error('listCountries Error', error);
            return [];
        }
    }

    async listVatRates(): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}vat`;
            const response = await axios.get(url, {
                headers,
                params: { limit: 50 },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200,
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error('listVatRates Error', error);
            return [];
        }
    }

    async listPaymentTypes(): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}paymenttypes`;
            const response = await axios.get(url, {
                headers,
                params: { limit: 50 },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200,
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            log.error('listPaymentTypes Error', error);
            return [];
        }
    }
}
