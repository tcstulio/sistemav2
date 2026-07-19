/**
 * Schemas Zod e helpers de normalização para o canal WhatsApp (#1568).
 *
 * Centraliza validação de número de telefone (formato + DDI) e os contratos
 * de input dos endpoints de envio (`/send`, `/send-bulk`, `/template`).
 * Extraído para módulo próprio para permitir testes unitários diretos das
 * regras (sem precisar subir o Express) e reuso entre rota + testes.
 */
import { z } from 'zod';

/**
 * Lista de DDIs (country calling codes) permitidos.
 * 55 = Brasil (default do sistema). Demais códigos cobrem tráfegos
 * internacionais comuns. Para adicionar um novo DDI basta incluí-lo abaixo —
 * a ordem não importa, mas os mais longos primeiro evitam ambiguidade em
 * futuras checagens por prefixo.
 */
export const ALLOWED_COUNTRY_CODES = [
    '55',  // Brasil
    '549', // Argentina
    '598', // Uruguai
    '1',   // EUA / Canadá
    '44',  // Reino Unido
    '351', // Portugal
    '34',  // Espanha
    '56',  // Chile
    '57',  // Colômbia
    '51',  // Peru
    '52',  // México
    '61',  // Austrália
    '33',  // França
    '49',  // Alemanha
    '39',  // Itália
];

/**
 * Normaliza um número de telefone removendo qualquer caractere não-numérico.
 * Ex.: "+55 (11) 98888-7777" → "5511988887777".
 *
 * Usada antes de chamar a API do WhatsApp para evitar variações de formatação
 * (@c.us, +, espaços, parênteses) cheg ao provider.
 */
export function normalizePhone(input: string): string {
    return (input || '').replace(/\D+/g, '');
}

/**
 * Verifica se o número (já normalizado, só dígitos) começa com um DDI
 * permitido em {@link ALLOWED_COUNTRY_CODES}.
 */
export function hasValidCountryCode(normalized: string): boolean {
    return ALLOWED_COUNTRY_CODES.some(cc => normalized.startsWith(cc));
}

/**
 * Schema Zod para número de telefone WhatsApp.
 *   - Apenas dígitos, entre 10 e 13 caracteres (E.164 sem o `+`).
 *   - DDI presente na lista de permitidos.
 *
 * Aceita a string crua do cliente; a normalização de formatação é aplicada
 * no handler da rota antes de bater no provider (item 5 da issue #1568).
 */
export const phoneSchema = z
    .string()
    .regex(/^\d{10,13}$/, { message: 'Número deve ter entre 10 e 13 dígitos numéricos' })
    .refine(hasValidCountryCode, { message: 'DDI não permitido' });

/**
 * Schema para `POST /send` (#1568).
 *   - `to`: número de telefone válido (phoneSchema).
 *   - `message`: texto entre 1 e 4096 caracteres (limite do WhatsApp).
 *   - `mediaUrl`: URL opcional de mídia anexa.
 */
export const sendSchema = z.object({
    to: phoneSchema,
    message: z.string().min(1).max(4096),
    mediaUrl: z.string().url().optional(),
    sessionId: z.string().optional()
});

/**
 * Schema para `POST /send-bulk` (#1568).
 *   - `recipients`: entre 1 e 100 números válidos.
 *   - `message`: texto entre 1 e 4096 caracteres.
 */
export const sendBulkSchema = z.object({
    recipients: z.array(phoneSchema).min(1).max(100),
    message: z.string().min(1).max(4096),
    sessionId: z.string().optional()
});

/**
 * Schema para `POST /template` (#1568).
 *   - `name`: nome do template (WhatsApp Business namespace).
 *   - `language`: código de idioma (ex.: `pt_BR`).
 *   - `components`: array estruturado de componentes do template.
 *   - `to`: destinatário opcional — quando presente é validado pelo phoneSchema
 *     e usado para disparar a mensagem; quando ausente, a rota apenas valida o
 *     payload do template (útil para pré-validação no cliente).
 */
export const templateSchema = z.object({
    name: z.string().min(1),
    language: z.string().min(1),
    components: z.array(z.any()),
    to: phoneSchema.optional(),
    sessionId: z.string().optional()
});
