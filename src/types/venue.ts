/**
 * Venue Types for Event Spaces (Partnerships)
 * 
 * These types represent the data structure for venue partnerships
 * as used throughout the frontend application.
 */

/**
 * Contact information for a venue
 */
export interface VenueContact {
    site: string | null;
    whatsapp: string | null;
    email: string | null;
    address: string | null;
}

/**
 * Capacity information for a venue
 */
export interface VenueCapacity {
    standing: number | null;      // Lotação em pé
    dinnerTable: number | null;   // Lotação mesa jantar
    smallTable: number | null;    // Lotação mesa pequena
    reference: number | null;     // Quantidade referência
}

/**
 * Ratings for a venue (scale 1-5)
 */
export interface VenueRatings {
    overall: number | null;       // Estrutura geral
    classification: number | null; // Classificação
    location: number | null;      // Localização
    size: number | null;          // Tamanho
    price: number | null;         // Preço
    greenRoom: number | null;     // Camarim
    tablesChairs: number | null;  // Mesas e cadeiras
    furniture: number | null;     // Mobiliário
    reception: number | null;     // Recepção
    parking: number | null;       // Estacionamento
    stage: number | null;         // Estrutura palco e shows
    equipment: number | null;     // Equipamentos e infraestrutura
}

/**
 * Pricing information by event type
 */
export interface VenuePricing {
    weekday: number | null;       // Dia da semana
    weekend: number | null;       // Final de semana
    corporate: number | null;     // Corporativo
    party: number | null;         // Festa
    cultural: number | null;      // Cultural
    partnership: number | null;   // Parceria
    package: number | null;       // Pacote de datas
}

/**
 * Complete Venue Partnership data
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
    contact: VenueContact;
    capacity: VenueCapacity;
    ratings: VenueRatings;
    pricing: VenuePricing;
    includedServices: string[];
    createdAt: number;
    updatedAt: string;
}

/**
 * Venue type categories with their labels
 */
export const VenueTypeLabels: Record<string, string> = {
    'tipo_chique': 'Alto Padrão',
    'tipo_estiloso': 'Estiloso',
    'tipo_corporativo': 'Corporativo',
};

/**
 * Rating field labels in Portuguese
 */
export const RatingLabels: Record<keyof VenueRatings, string> = {
    overall: 'Estrutura Geral',
    classification: 'Classificação',
    location: 'Localização',
    size: 'Tamanho',
    price: 'Preço',
    greenRoom: 'Camarim',
    tablesChairs: 'Mesas e Cadeiras',
    furniture: 'Mobiliário',
    reception: 'Recepção',
    parking: 'Estacionamento',
    stage: 'Palco e Shows',
    equipment: 'Equipamentos',
};

/**
 * Pricing field labels in Portuguese
 */
export const PricingLabels: Record<keyof VenuePricing, string> = {
    weekday: 'Dia de Semana',
    weekend: 'Final de Semana',
    corporate: 'Corporativo',
    party: 'Festa',
    cultural: 'Cultural',
    partnership: 'Parceria',
    package: 'Pacote de Datas',
};

/**
 * Get the maximum capacity across all configurations
 */
export function getMaxCapacity(venue: VenuePartnership): number {
    const capacities = [
        venue.capacity.standing,
        venue.capacity.dinnerTable,
        venue.capacity.smallTable,
        venue.capacity.reference
    ].filter((c): c is number => c !== null);

    return capacities.length > 0 ? Math.max(...capacities) : 0;
}

/**
 * Get average rating for a venue
 */
export function getAverageRating(venue: VenuePartnership): number {
    const ratings = Object.values(venue.ratings).filter((r): r is number => r !== null);
    if (ratings.length === 0) return 0;
    return ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
}

/**
 * Get the best price available for a venue
 */
export function getBestPrice(venue: VenuePartnership): number | null {
    const prices = Object.values(venue.pricing).filter((p): p is number => p !== null && p > 0);
    if (prices.length === 0) return null;
    return Math.min(...prices);
}

/**
 * Format capacity display string
 */
export function formatCapacity(venue: VenuePartnership): string {
    const parts: string[] = [];
    if (venue.capacity.standing) parts.push(`${venue.capacity.standing} em pé`);
    if (venue.capacity.dinnerTable) parts.push(`${venue.capacity.dinnerTable} jantar`);
    if (venue.capacity.smallTable) parts.push(`${venue.capacity.smallTable} coquetel`);
    return parts.join(' | ') || 'Não informado';
}
