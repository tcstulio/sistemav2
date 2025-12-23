/**
 * Dolibarr Service - Third Parties Module
 * 
 * Methods for managing customers, suppliers, and contacts.
 */

import axios from 'axios';
import { DolibarrServiceBase, CreateThirdPartyModel } from './core';

export class DolibarrThirdPartiesService extends DolibarrServiceBase {

    async createThirdParty(data: CreateThirdPartyModel, userKey?: string) {
        const url = `${this.baseUrl}thirdparties`;
        return this.requestWithAuth('POST', url, data, userKey);
    }

    async getThirdPartyByPhone(phoneNumber: string): Promise<any | null> {
        try {
            const clean = phoneNumber.replace(/\D/g, '');
            const search = clean.length > 8 ? clean.substring(clean.length - 8) : clean;

            const headers = this.getHeaders();
            const url = `${this.baseUrl}thirdparties`;
            const sqlfilters = `(t.phone:like:'%${search}%') or (t.phone_mobile:like:'%${search}%')`;

            const response = await axios.get(url, {
                headers,
                params: { sqlfilters, limit: 1 },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200 || s === 404
            });

            if (response.status === 200 && Array.isArray(response.data) && response.data.length > 0) {
                const found = response.data[0];
                console.log(`[DoliService] Phone match found: ${found.name} (ID: ${found.id})`);
                return found;
            }
            return null;
        } catch (error: any) {
            console.error(`[DoliService] Phone Search Error for ${phoneNumber}:`, error.message);
            return null;
        }
    }

    async getThirdParty(id: string): Promise<any | null> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}thirdparties/${id}`;

            const response = await axios.get(url, {
                headers,
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200 || s === 404
            });

            if (response.status === 200 && response.data) {
                return response.data;
            }
            return null;
        } catch (error: any) {
            console.error(`[DoliService] GetThirdParty Error for ${id}:`, error.message);
            return null;
        }
    }

    async searchThirdParty(query: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}thirdparties`;
            const sqlfilters = `(t.nom:like:'%${query}%') or (t.name_alias:like:'%${query}%') or (t.email:like:'%${query}%')`;

            const response = await axios.get(url, {
                headers,
                params: { sqlfilters, limit: 5 },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });

            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            console.error("searchThirdParty Error", error);
            return [];
        }
    }

    async getCustomerContext(thirdPartyId: string): Promise<string> {
        if (!thirdPartyId) return "Dados do cliente não identificados.";

        try {
            const headers = this.getHeaders();

            const invoicesUrl = `${this.baseUrl}invoices`;
            const invPromise = axios.get(invoicesUrl, {
                headers,
                params: {
                    sqlfilters: `(t.fk_soc:=:${thirdPartyId}) and (t.paye:=:0) and (t.fk_statut:>:0)`,
                    limit: 5,
                    sortfield: 't.datef',
                    sortorder: 'DESC'
                },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s < 500
            });

            const projectsUrl = `${this.baseUrl}projects`;
            const projPromise = axios.get(projectsUrl, {
                headers,
                params: {
                    sqlfilters: `(t.fk_soc:=:${thirdPartyId})`,
                    limit: 3,
                    sortfield: 't.datec',
                    sortorder: 'DESC'
                },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s < 500
            });

            const agendaUrl = `${this.baseUrl}agenda/events`;
            const agendaPromise = axios.get(agendaUrl, {
                headers,
                params: {
                    sqlfilters: `(t.fk_soc:=:${thirdPartyId})`,
                    limit: 3,
                    sortfield: 't.datep',
                    sortorder: 'DESC'
                },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s < 500
            });

            const [invRes, projRes, agendaRes] = await Promise.all([invPromise, projPromise, agendaPromise]);

            let context = `CLIENTE ID: ${thirdPartyId}\n`;

            context += "\nFATURAS EM ABERTO:\n";
            if (invRes.status === 200 && Array.isArray(invRes.data) && invRes.data.length > 0) {
                invRes.data.forEach((inv: any) => {
                    context += `- Ref: ${inv.ref}, Total: R$ ${parseFloat(inv.total_ttc || 0).toFixed(2)}, Data: ${new Date(inv.date * 1000).toLocaleDateString()}\n`;
                });
            } else {
                context += "(Nenhuma fatura pendente encontrada)\n";
            }

            context += "\nPROJETOS RECENTES:\n";
            if (projRes.status === 200 && Array.isArray(projRes.data) && projRes.data.length > 0) {
                projRes.data.forEach((p: any) => {
                    context += `- [${p.ref}] ${p.title} (Status: ${p.statut === 1 ? 'Aberto' : 'Fechado'})\n`;
                });
            } else {
                context += "(Nenhum projeto recente)\n";
            }

            context += "\nPRÓXIMOS EVENTOS/AGENDA:\n";
            if (agendaRes.status === 200 && Array.isArray(agendaRes.data) && agendaRes.data.length > 0) {
                agendaRes.data.forEach((ev: any) => {
                    const date = ev.datep ? new Date(ev.datep * 1000).toLocaleDateString() : 'N/A';
                    context += `- ${date}: ${ev.label} (${ev.type_code || 'Geral'})\n`;
                });
            } else {
                context += "(Nenhum evento na agenda)\n";
            }

            return context;
        } catch (error) {
            console.error('[DoliService] Context Fetch Error:', error);
            return "Erro ao buscar dados detalhados do cliente no CRM.";
        }
    }

    async listSuppliers(search?: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}thirdparties`;
            let sqlfilters = `(t.fournisseur:=:1)`;
            if (search) {
                sqlfilters += ` and ((t.nom:like:'%${search}%') or (t.name_alias:like:'%${search}%'))`;
            }
            const response = await axios.get(url, {
                headers,
                params: { sqlfilters, limit: 10 },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            console.error("listSuppliers Error", error);
            return [];
        }
    }

    async listContacts(search?: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}contacts`;
            let sqlfilters = undefined;
            if (search) {
                sqlfilters = `(t.firstname:like:'%${search}%') or (t.lastname:like:'%${search}%') or (t.email:like:'%${search}%')`;
            }
            const response = await axios.get(url, {
                headers,
                params: { sqlfilters, limit: 10 },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            console.error("listContacts Error", error);
            return [];
        }
    }

    async listCategories(type?: string): Promise<any[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}categories`;
            const response = await axios.get(url, {
                headers,
                params: { type: type || undefined, limit: 20 },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });
            return Array.isArray(response.data) ? response.data : [];
        } catch (error) {
            console.error("listCategories Error", error);
            return [];
        }
    }
}
