/**
 * Venue API service — create/update/delete helpers for Espaços (partnerships).
 *
 * Writes pass through the existing wildcard proxy in dolibarrRoutes.ts
 * (router.all('/*')) — no new backend routes needed.
 */
import { DolibarrConfig } from '../../types';
import { request, sanitizeUrl, getHeaders } from './core';
import { logger } from '../../utils/logger';

const log = logger.child('VenueService');

/** Payload shape matching Dolibarr partnerships API with array_options for extrafields */
export interface VenuePayload {
    /** Dolibarr partnerships type_code */
    type_code?: string;
    /** FK to third-party (empresa) — pass '0' or omit if unknown */
    fk_soc?: string | number;
    array_options: {
        options_nome_espaco?: string;
        options_descreva?: string;
        options_endereco?: string;
        options_site?: string;
        options_whatsapp?: string;
        options_email?: string;
        // Capacity
        options_lotacao_em_pe?: string;
        options_lotacao_mesa_jantar?: string;
        options_lotacao_mesa_pequena?: string;
        options_quantidade_pessoas?: string;
        // Pricing
        options_negociacao_dia_da_semana?: string;
        options_negociacao_final_de_semana?: string;
        options_negociacao_corporativo?: string;
        options_negociacao_festa?: string;
        options_negociacao_cultural?: string;
        options_negociacao_parceria?: string;
        options_negociacao_pacote_datas?: string;
        // Ratings
        options_estrutura_geral?: string;
        options_classificacao?: string;
        options_localizacao?: string;
        options_tamanho?: string;
        options_preco?: string;
        options_camarim?: string;
        options_mesas_e_cadeiras?: string;
        options_mobiliario?: string;
        options_recepcao?: string;
        options_estacionamento?: string;
        options_estrutura_palco_e_shows?: string;
        options_equipamentos_e_infraestrutura_eventos?: string;
        // Services
        options_servicos_inclusos?: string;
        [key: string]: string | undefined;
    };
}

/** Create a new venue partnership. Returns the created object or its id. */
export const createVenue = async (config: DolibarrConfig, payload: VenuePayload): Promise<any> => {
    const url = `${sanitizeUrl(config.apiUrl)}/partnerships/partnerships`;
    log.debug('createVenue', payload);
    return request(url, {
        method: 'POST',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(payload),
    });
};

/** Update an existing venue partnership by id. */
export const updateVenue = async (config: DolibarrConfig, id: string, payload: VenuePayload): Promise<any> => {
    const url = `${sanitizeUrl(config.apiUrl)}/partnerships/partnerships/${id}`;
    log.debug(`updateVenue id=${id}`, payload);
    return request(url, {
        method: 'PUT',
        headers: getHeaders(config.apiKey),
        body: JSON.stringify(payload),
    });
};

/** Delete a venue partnership by id. */
export const deleteVenue = async (config: DolibarrConfig, id: string): Promise<any> => {
    const url = `${sanitizeUrl(config.apiUrl)}/partnerships/partnerships/${id}`;
    log.debug(`deleteVenue id=${id}`);
    return request(url, {
        method: 'DELETE',
        headers: getHeaders(config.apiKey),
    });
};
