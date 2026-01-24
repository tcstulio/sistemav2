/**
 * Dolibarr Service - Partnerships Module
 * 
 * Methods for managing venue partnerships (event spaces).
 */

import axios from 'axios';
import { DolibarrServiceBase } from './core';

/**
 * Venue Partnership extra fields structure
 */
export interface VenueExtraFields {
    options_nome_espaco?: string;
    options_site?: string | null;
    options_whatsapp?: string | null;
    options_email?: string | null;
    options_endereco?: string;
    options_lotacao_em_pe?: string | null;
    options_lotacao_mesa_jantar?: string | null;
    options_lotacao_mesa_pequena?: string | null;
    options_quantidade_pessoas?: string | null;
    options_servicos_inclusos?: string | null;
    options_descreva?: string | null;
    // Ratings (1-5)
    options_estrutura_geral?: string | null;
    options_classificacao?: string | null;
    options_localizacao?: string | null;
    options_tamanho?: string | null;
    options_preco?: string | null;
    options_camarim?: string | null;
    options_mesas_e_cadeiras?: string | null;
    options_mobiliario?: string | null;
    options_recepcao?: string | null;
    options_estacionamento?: string | null;
    options_estrutura_palco_e_shows?: string | null;
    options_equipamentos_e_infraestrutura_eventos?: string | null;
    // Pricing by event type
    options_negociacao_dia_da_semana?: string | null;
    options_negociacao_final_de_semana?: string | null;
    options_negociacao_corporativo?: string | null;
    options_negociacao_festa?: string | null;
    options_negociacao_cultural?: string | null;
    options_negociacao_parceria?: string | null;
    options_negociacao_pacote_datas?: string | null;
}

/**
 * Raw Partnership data from Dolibarr API
 */
export interface DolibarrPartnership {
    id: string;
    ref: string;
    ref_ext?: string | null;
    status: string;
    fk_soc: string;
    fk_member?: string | null;
    fk_type: string;
    type_code: string;
    type_label: string;
    date_partnership_start: number | string;
    date_partnership_end?: number | string;
    note_private?: string | null;
    note_public?: string | null;
    date_creation: number;
    tms: string;
    array_options: VenueExtraFields;
}

/**
 * Processed Venue data for frontend use
 */
export interface VenuePartnership {
    id: string;
    ref: string;
    name: string;
    description: string | null;
    typeCode: string;
    typeLabel: string;
    status: string;
    fkSoc: string;
    startDate: number | string;
    endDate?: number | string;
    notes: string | null;
    contact: {
        site: string | null;
        whatsapp: string | null;
        email: string | null;
        address: string | null;
    };
    capacity: {
        standing: number | null;
        dinnerTable: number | null;
        smallTable: number | null;
        reference: number | null;
    };
    ratings: {
        overall: number | null;
        classification: number | null;
        location: number | null;
        size: number | null;
        price: number | null;
        greenRoom: number | null;
        tablesChairs: number | null;
        furniture: number | null;
        reception: number | null;
        parking: number | null;
        stage: number | null;
        equipment: number | null;
    };
    pricing: {
        weekday: number | null;
        weekend: number | null;
        corporate: number | null;
        party: number | null;
        cultural: number | null;
        partnership: number | null;
        package: number | null;
    };
    includedServices: string[];
    createdAt: number;
    updatedAt: string;
}

export class DolibarrPartnershipsService extends DolibarrServiceBase {

    /**
     * Parse a numeric string with potential decimals
     */
    private parseNumber(value: string | null | undefined): number | null {
        if (!value) return null;
        const num = parseFloat(value);
        return isNaN(num) ? null : num;
    }

    /**
     * Transform raw Dolibarr partnership to clean VenuePartnership object
     */
    private transformPartnership(raw: DolibarrPartnership): VenuePartnership {
        const opts = raw.array_options || {};

        return {
            id: raw.id,
            ref: raw.ref,
            name: opts.options_nome_espaco || `Partnership ${raw.id}`,
            description: opts.options_descreva || null,
            typeCode: raw.type_code,
            typeLabel: raw.type_label,
            status: raw.status,
            fkSoc: raw.fk_soc,
            startDate: raw.date_partnership_start,
            endDate: raw.date_partnership_end,
            notes: raw.note_private || null,
            contact: {
                site: opts.options_site || null,
                whatsapp: opts.options_whatsapp || null,
                email: opts.options_email || null,
                address: opts.options_endereco || null,
            },
            capacity: {
                standing: this.parseNumber(opts.options_lotacao_em_pe),
                dinnerTable: this.parseNumber(opts.options_lotacao_mesa_jantar),
                smallTable: this.parseNumber(opts.options_lotacao_mesa_pequena),
                reference: this.parseNumber(opts.options_quantidade_pessoas),
            },
            ratings: {
                overall: this.parseNumber(opts.options_estrutura_geral),
                classification: this.parseNumber(opts.options_classificacao),
                location: this.parseNumber(opts.options_localizacao),
                size: this.parseNumber(opts.options_tamanho),
                price: this.parseNumber(opts.options_preco),
                greenRoom: this.parseNumber(opts.options_camarim),
                tablesChairs: this.parseNumber(opts.options_mesas_e_cadeiras),
                furniture: this.parseNumber(opts.options_mobiliario),
                reception: this.parseNumber(opts.options_recepcao),
                parking: this.parseNumber(opts.options_estacionamento),
                stage: this.parseNumber(opts.options_estrutura_palco_e_shows),
                equipment: this.parseNumber(opts.options_equipamentos_e_infraestrutura_eventos),
            },
            pricing: {
                weekday: this.parseNumber(opts.options_negociacao_dia_da_semana),
                weekend: this.parseNumber(opts.options_negociacao_final_de_semana),
                corporate: this.parseNumber(opts.options_negociacao_corporativo),
                party: this.parseNumber(opts.options_negociacao_festa),
                cultural: this.parseNumber(opts.options_negociacao_cultural),
                partnership: this.parseNumber(opts.options_negociacao_parceria),
                package: this.parseNumber(opts.options_negociacao_pacote_datas),
            },
            includedServices: opts.options_servicos_inclusos
                ? opts.options_servicos_inclusos.split(',').map(s => s.trim()).filter(Boolean)
                : [],
            createdAt: raw.date_creation,
            updatedAt: raw.tms,
        };
    }

    /**
     * List all partnerships (venues)
     */
    async listPartnerships(params: { limit?: number, status?: string } = {}): Promise<VenuePartnership[]> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}partnerships/partnerships`;

            let sqlfilters: string | undefined;
            if (params.status) {
                sqlfilters = `(t.status:=:${params.status})`;
            }

            const response = await axios.get(url, {
                headers,
                params: {
                    limit: params.limit || 100,
                    sortfield: 't.rowid',
                    sortorder: 'DESC',
                    sqlfilters
                },
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200
            });

            if (!Array.isArray(response.data)) {
                return [];
            }

            return response.data.map((p: DolibarrPartnership) => this.transformPartnership(p));
        } catch (error: any) {
            console.error('[DoliService] listPartnerships Error:', error.message);
            return [];
        }
    }

    /**
     * Get a single partnership by ID
     */
    async getPartnership(id: string): Promise<VenuePartnership | null> {
        try {
            const headers = this.getHeaders();
            const url = `${this.baseUrl}partnerships/partnerships/${id}`;

            const response = await axios.get(url, {
                headers,
                httpsAgent: this.httpsAgent,
                validateStatus: (s) => s === 200 || s === 404
            });

            if (response.status === 200 && response.data) {
                return this.transformPartnership(response.data as DolibarrPartnership);
            }
            return null;
        } catch (error: any) {
            console.error(`[DoliService] getPartnership Error for ${id}:`, error.message);
            return null;
        }
    }

    /**
     * Search partnerships by name or capacity
     */
    async searchPartnerships(params: {
        search?: string;
        minCapacity?: number;
        typeCode?: string;
        limit?: number;
    } = {}): Promise<VenuePartnership[]> {
        try {
            // Fetch all and filter client-side since Dolibarr SQL filters don't support extrafields well
            const all = await this.listPartnerships({ limit: params.limit || 100 });

            let filtered = all;

            if (params.search) {
                const searchLower = params.search.toLowerCase();
                filtered = filtered.filter(v =>
                    v.name.toLowerCase().includes(searchLower) ||
                    (v.description && v.description.toLowerCase().includes(searchLower))
                );
            }

            if (params.minCapacity) {
                filtered = filtered.filter(v =>
                    (v.capacity.standing && v.capacity.standing >= params.minCapacity!) ||
                    (v.capacity.dinnerTable && v.capacity.dinnerTable >= params.minCapacity!) ||
                    (v.capacity.reference && v.capacity.reference >= params.minCapacity!)
                );
            }

            if (params.typeCode) {
                filtered = filtered.filter(v => v.typeCode === params.typeCode);
            }

            return filtered;
        } catch (error: any) {
            console.error('[DoliService] searchPartnerships Error:', error.message);
            return [];
        }
    }

    /**
     * Get partnerships grouped by type
     */
    async getPartnershipsByType(): Promise<Record<string, VenuePartnership[]>> {
        const all = await this.listPartnerships();
        const grouped: Record<string, VenuePartnership[]> = {};

        for (const v of all) {
            const key = v.typeLabel || 'Sem Tipo';
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(v);
        }

        return grouped;
    }

    /**
     * Get venue pricing summary for a specific event type
     */
    getPricingForEventType(venue: VenuePartnership, eventType: 'weekday' | 'weekend' | 'corporate' | 'party' | 'cultural'): number | null {
        return venue.pricing[eventType];
    }
}
