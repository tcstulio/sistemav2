import React, { useState, useMemo, useEffect } from 'react';
import { Building2, Search, MapPin, Users, Star, DollarSign, ExternalLink, X, ArrowLeft, Globe, Phone, Mail, Calendar, PartyPopper, Briefcase, Music, Loader2, Filter } from 'lucide-react';
import { useDolibarr } from '../context/DolibarrContext';
import {
    VenuePartnership,
    getMaxCapacity,
    getAverageRating,
    getBestPrice,
    formatCapacity,
    RatingLabels,
    PricingLabels
} from '../types/venue';
import { DolibarrService } from '../services/dolibarrService';
import { fetchList } from '../services/api/core';
import { AppView } from '../types';
import { formatDateOnly } from '../utils/dateUtils';

interface VenueListProps {
    onNavigate?: (view: AppView, id: string) => void;
    onSelectVenue?: (venue: VenuePartnership) => void; // For simulator integration
}

export const VenueList: React.FC<VenueListProps> = ({ onNavigate, onSelectVenue }) => {
    const { config } = useDolibarr();
    const [venues, setVenues] = useState<VenuePartnership[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedVenue, setSelectedVenue] = useState<VenuePartnership | null>(null);
    const [activeTab, setActiveTab] = useState<'overview' | 'capacity' | 'pricing' | 'ratings'>('overview');
    const [filterType, setFilterType] = useState<string>('');
    const [showFilters, setShowFilters] = useState(false);

    // Fetch venues
    useEffect(() => {
        const fetchVenues = async () => {
            if (!config) return;
            setIsLoading(true);
            setError(null);
            try {
                // Use fetchList to get partnerships from API
                const response = await fetchList(config, 'partnerships/partnerships');

                // Transform raw data to VenuePartnership format
                const transformed = (response || []).map((p: any) => transformPartnership(p));
                setVenues(transformed);
            } catch (e: any) {
                console.error('Erro ao buscar espaços:', e);
                setError(e.message || 'Erro ao buscar espaços');
            } finally {
                setIsLoading(false);
            }
        };
        fetchVenues();
    }, [config]);

    // Transform raw partnership data
    const transformPartnership = (raw: any): VenuePartnership => {
        const opts = raw.array_options || {};
        const parseNumber = (v: string | null | undefined): number | null => {
            if (!v) return null;
            const num = parseFloat(v);
            return isNaN(num) ? null : num;
        };

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
                standing: parseNumber(opts.options_lotacao_em_pe),
                dinnerTable: parseNumber(opts.options_lotacao_mesa_jantar),
                smallTable: parseNumber(opts.options_lotacao_mesa_pequena),
                reference: parseNumber(opts.options_quantidade_pessoas),
            },
            ratings: {
                overall: parseNumber(opts.options_estrutura_geral),
                classification: parseNumber(opts.options_classificacao),
                location: parseNumber(opts.options_localizacao),
                size: parseNumber(opts.options_tamanho),
                price: parseNumber(opts.options_preco),
                greenRoom: parseNumber(opts.options_camarim),
                tablesChairs: parseNumber(opts.options_mesas_e_cadeiras),
                furniture: parseNumber(opts.options_mobiliario),
                reception: parseNumber(opts.options_recepcao),
                parking: parseNumber(opts.options_estacionamento),
                stage: parseNumber(opts.options_estrutura_palco_e_shows),
                equipment: parseNumber(opts.options_equipamentos_e_infraestrutura_eventos),
            },
            pricing: {
                weekday: parseNumber(opts.options_negociacao_dia_da_semana),
                weekend: parseNumber(opts.options_negociacao_final_de_semana),
                corporate: parseNumber(opts.options_negociacao_corporativo),
                party: parseNumber(opts.options_negociacao_festa),
                cultural: parseNumber(opts.options_negociacao_cultural),
                partnership: parseNumber(opts.options_negociacao_parceria),
                package: parseNumber(opts.options_negociacao_pacote_datas),
            },
            includedServices: opts.options_servicos_inclusos
                ? opts.options_servicos_inclusos.split(',').map((s: string) => s.trim()).filter(Boolean)
                : [],
            createdAt: raw.date_creation,
            updatedAt: raw.tms,
        };
    };

    // Filter venues
    const filteredVenues = useMemo(() => {
        let result = venues;

        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            result = result.filter(v =>
                v.name.toLowerCase().includes(term) ||
                (v.description && v.description.toLowerCase().includes(term)) ||
                v.typeLabel.toLowerCase().includes(term)
            );
        }

        if (filterType) {
            result = result.filter(v => v.typeCode === filterType);
        }

        return result;
    }, [venues, searchTerm, filterType]);

    // Get unique types for filter
    const venueTypes = useMemo(() => {
        const types = new Map<string, string>();
        venues.forEach(v => {
            if (v.typeCode && v.typeLabel) {
                types.set(v.typeCode, v.typeLabel);
            }
        });
        return Array.from(types.entries());
    }, [venues]);

    // Render star rating
    const renderStars = (rating: number | null) => {
        if (rating === null) return <span className="text-slate-400 text-xs">N/A</span>;
        return (
            <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map(i => (
                    <Star
                        key={i}
                        size={14}
                        className={i <= rating ? 'text-amber-400 fill-amber-400' : 'text-slate-300'}
                    />
                ))}
            </div>
        );
    };

    // Format price display
    const formatPrice = (price: number | null) => {
        if (price === null) return 'Sob consulta';
        return `R$ ${price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    };

    // Handle venue selection for simulator
    const handleSelectForSimulator = () => {
        if (selectedVenue && onSelectVenue) {
            onSelectVenue(selectedVenue);
        }
    };

    if (!config) return <div className="p-8 text-center">Carregando configuração...</div>;

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors relative">
            {/* Header */}
            <div className={`p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none ${selectedVenue ? 'hidden lg:block' : 'block'}`}>
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                            <Building2 className="text-indigo-600" size={28} />
                            Espaços de Eventos
                        </h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            {venues.length} espaços cadastrados
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowFilters(!showFilters)}
                            className={`p-2 rounded-lg border transition-colors ${showFilters
                                ? 'bg-indigo-100 border-indigo-300 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-700'
                                : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                                }`}
                        >
                            <Filter size={18} />
                        </button>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                type="text"
                                placeholder="Buscar espaços..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10 pr-4 py-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white w-64"
                            />
                        </div>
                    </div>
                </div>

                {/* Filters */}
                {showFilters && (
                    <div className="flex gap-4 items-center bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                        <label className="text-sm font-medium text-slate-600 dark:text-slate-400">Tipo:</label>
                        <select
                            value={filterType}
                            onChange={(e) => setFilterType(e.target.value)}
                            className="px-3 py-1.5 border rounded-lg text-sm dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                        >
                            <option value="">Todos</option>
                            {venueTypes.map(([code, label]) => (
                                <option key={code} value={code}>{label}</option>
                            ))}
                        </select>
                        {filterType && (
                            <button
                                onClick={() => setFilterType('')}
                                className="text-xs text-indigo-600 hover:underline"
                            >
                                Limpar filtros
                            </button>
                        )}
                    </div>
                )}
            </div>

            <div className="flex-1 min-h-0 flex overflow-hidden">
                {/* List */}
                <div className={`flex-1 overflow-y-auto p-4 md:p-6 ${selectedVenue ? 'hidden lg:block lg:w-1/3 xl:w-1/4 border-r border-slate-200 dark:border-slate-800' : 'w-full'}`}>
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                            <Loader2 size={48} className="animate-spin mb-4" />
                            <p>Carregando espaços...</p>
                        </div>
                    ) : error ? (
                        <div className="text-center py-20 text-red-500">
                            <p>{error}</p>
                        </div>
                    ) : filteredVenues.length === 0 ? (
                        <div className="text-center py-20 text-slate-400">
                            <Building2 size={48} className="mx-auto mb-4 opacity-50" />
                            <p>Nenhum espaço encontrado.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-1 gap-4">
                            {filteredVenues.map(venue => (
                                <div
                                    key={venue.id}
                                    onClick={() => setSelectedVenue(venue)}
                                    className={`p-4 border rounded-xl cursor-pointer transition-all ${selectedVenue?.id === venue.id
                                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 ring-1 ring-indigo-500'
                                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:shadow-md hover:border-indigo-300'
                                        }`}
                                >
                                    <div className="flex justify-between items-start mb-2">
                                        <h4 className="font-bold text-slate-800 dark:text-white">{venue.name}</h4>
                                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                            {venue.typeLabel}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400 mb-3">
                                        <div className="flex items-center gap-1">
                                            <Users size={14} />
                                            <span>{getMaxCapacity(venue) || 'N/A'}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            {renderStars(getAverageRating(venue))}
                                        </div>
                                    </div>

                                    <div className="flex justify-between items-end">
                                        <span className="text-xs text-slate-500">{venue.ref}</span>
                                        {getBestPrice(venue) !== null && (
                                            <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                                                A partir de {formatPrice(getBestPrice(venue))}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Detail Panel */}
                <div className={`flex-1 bg-white dark:bg-slate-900 flex flex-col ${selectedVenue ? 'block absolute inset-0 z-20 lg:static lg:inset-auto' : 'hidden lg:flex lg:items-center lg:justify-center'}`}>
                    {selectedVenue ? (
                        <>
                            {/* Detail Header */}
                            <div className="flex-none bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 p-4 flex items-center justify-between z-10">
                                <div className="flex items-center gap-3">
                                    <button onClick={() => setSelectedVenue(null)} className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white">
                                        <ArrowLeft size={20} />
                                    </button>
                                    <div>
                                        <h2 className="text-lg font-bold dark:text-white">{selectedVenue.name}</h2>
                                        <span className="text-xs text-slate-500">{selectedVenue.typeLabel} • {selectedVenue.ref}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {onSelectVenue && (
                                        <button
                                            onClick={handleSelectForSimulator}
                                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium flex items-center gap-1.5"
                                        >
                                            <PartyPopper size={16} /> Usar no Simulador
                                        </button>
                                    )}
                                    <button onClick={() => setSelectedVenue(null)} className="hidden lg:block p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                                        <X size={20} />
                                    </button>
                                </div>
                            </div>

                            {/* Tabs */}
                            <div className="flex border-b border-slate-100 dark:border-slate-800 px-4 overflow-x-auto flex-none bg-slate-50 dark:bg-slate-800/30">
                                {['overview', 'capacity', 'pricing', 'ratings'].map(tab => (
                                    <button
                                        key={tab}
                                        onClick={() => setActiveTab(tab as any)}
                                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab
                                            ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                                            : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                            }`}
                                    >
                                        {tab === 'overview' && 'Visão Geral'}
                                        {tab === 'capacity' && 'Capacidade'}
                                        {tab === 'pricing' && 'Preços'}
                                        {tab === 'ratings' && 'Avaliações'}
                                    </button>
                                ))}
                            </div>

                            {/* Content */}
                            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                                <div className="max-w-3xl mx-auto space-y-6">
                                    {activeTab === 'overview' && (
                                        <>
                                            {/* Description */}
                                            {selectedVenue.description && (
                                                <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                                    <h3 className="font-bold text-slate-800 dark:text-white mb-3">Descrição</h3>
                                                    <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed"
                                                        dangerouslySetInnerHTML={{ __html: selectedVenue.description.replace(/\n/g, '<br/>') }}
                                                    />
                                                </div>
                                            )}

                                            {/* Contact Info */}
                                            <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                                <h3 className="font-bold text-slate-800 dark:text-white mb-4">Contato</h3>
                                                <div className="space-y-3">
                                                    {selectedVenue.contact.address && (
                                                        <div className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
                                                            <MapPin size={16} className="text-slate-400" />
                                                            {selectedVenue.contact.address}
                                                        </div>
                                                    )}
                                                    {selectedVenue.contact.whatsapp && (
                                                        <div className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
                                                            <Phone size={16} className="text-slate-400" />
                                                            {selectedVenue.contact.whatsapp}
                                                        </div>
                                                    )}
                                                    {selectedVenue.contact.email && (
                                                        <div className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
                                                            <Mail size={16} className="text-slate-400" />
                                                            {selectedVenue.contact.email}
                                                        </div>
                                                    )}
                                                    {selectedVenue.contact.site && (
                                                        <a
                                                            href={selectedVenue.contact.site}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="flex items-center gap-3 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                                                        >
                                                            <Globe size={16} />
                                                            {selectedVenue.contact.site}
                                                            <ExternalLink size={12} />
                                                        </a>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Notes */}
                                            {selectedVenue.notes && (
                                                <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-xl border border-amber-200 dark:border-amber-800">
                                                    <h4 className="font-medium text-amber-800 dark:text-amber-200 mb-2 text-sm">Observações Internas</h4>
                                                    <p className="text-amber-700 dark:text-amber-300 text-sm">{selectedVenue.notes}</p>
                                                </div>
                                            )}

                                            {/* Quick Stats */}
                                            <div className="grid grid-cols-3 gap-4">
                                                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 text-center">
                                                    <Users className="mx-auto text-indigo-500 mb-2" size={24} />
                                                    <div className="text-2xl font-bold text-slate-800 dark:text-white">{getMaxCapacity(selectedVenue) || 'N/A'}</div>
                                                    <div className="text-xs text-slate-500">Capacidade Máx.</div>
                                                </div>
                                                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 text-center">
                                                    <Star className="mx-auto text-amber-500 mb-2" size={24} />
                                                    <div className="text-2xl font-bold text-slate-800 dark:text-white">{getAverageRating(selectedVenue).toFixed(1)}</div>
                                                    <div className="text-xs text-slate-500">Avaliação Média</div>
                                                </div>
                                                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 text-center">
                                                    <DollarSign className="mx-auto text-emerald-500 mb-2" size={24} />
                                                    <div className="text-lg font-bold text-slate-800 dark:text-white">{formatPrice(getBestPrice(selectedVenue))}</div>
                                                    <div className="text-xs text-slate-500">Preço Base</div>
                                                </div>
                                            </div>
                                        </>
                                    )}

                                    {activeTab === 'capacity' && (
                                        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                            <h3 className="font-bold text-slate-800 dark:text-white mb-4">Capacidades</h3>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                                                    <div className="text-3xl font-bold text-slate-800 dark:text-white">
                                                        {selectedVenue.capacity.standing || '-'}
                                                    </div>
                                                    <div className="text-sm text-slate-500 mt-1">Em pé</div>
                                                </div>
                                                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                                                    <div className="text-3xl font-bold text-slate-800 dark:text-white">
                                                        {selectedVenue.capacity.dinnerTable || '-'}
                                                    </div>
                                                    <div className="text-sm text-slate-500 mt-1">Mesa de Jantar</div>
                                                </div>
                                                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                                                    <div className="text-3xl font-bold text-slate-800 dark:text-white">
                                                        {selectedVenue.capacity.smallTable || '-'}
                                                    </div>
                                                    <div className="text-sm text-slate-500 mt-1">Mesa Coquetel</div>
                                                </div>
                                                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                                                    <div className="text-3xl font-bold text-slate-800 dark:text-white">
                                                        {selectedVenue.capacity.reference || '-'}
                                                    </div>
                                                    <div className="text-sm text-slate-500 mt-1">Referência</div>
                                                </div>
                                            </div>

                                            {selectedVenue.includedServices.length > 0 && (
                                                <div className="mt-6 pt-6 border-t border-slate-100 dark:border-slate-800">
                                                    <h4 className="font-medium text-slate-800 dark:text-white mb-3">Serviços Inclusos</h4>
                                                    <div className="flex flex-wrap gap-2">
                                                        {selectedVenue.includedServices.map(serviceId => (
                                                            <span key={serviceId} className="px-2 py-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded text-xs">
                                                                Serviço #{serviceId}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {activeTab === 'pricing' && (
                                        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                            <h3 className="font-bold text-slate-800 dark:text-white mb-4">Tabela de Preços</h3>
                                            <div className="space-y-3">
                                                {Object.entries(selectedVenue.pricing).map(([key, value]) => (
                                                    <div key={key} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                                                        <div className="flex items-center gap-2">
                                                            {key === 'weekday' && <Calendar size={16} className="text-slate-400" />}
                                                            {key === 'weekend' && <Calendar size={16} className="text-indigo-500" />}
                                                            {key === 'corporate' && <Briefcase size={16} className="text-blue-500" />}
                                                            {key === 'party' && <PartyPopper size={16} className="text-pink-500" />}
                                                            {key === 'cultural' && <Music size={16} className="text-purple-500" />}
                                                            <span className="text-slate-700 dark:text-slate-300 font-medium">
                                                                {PricingLabels[key as keyof typeof PricingLabels]}
                                                            </span>
                                                        </div>
                                                        <span className={`font-bold ${value ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                                                            {formatPrice(value as number | null)}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {activeTab === 'ratings' && (
                                        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                            <h3 className="font-bold text-slate-800 dark:text-white mb-4">Avaliações do Espaço</h3>
                                            <div className="space-y-4">
                                                {Object.entries(selectedVenue.ratings).map(([key, value]) => (
                                                    <div key={key} className="flex justify-between items-center">
                                                        <span className="text-slate-600 dark:text-slate-400">
                                                            {RatingLabels[key as keyof typeof RatingLabels]}
                                                        </span>
                                                        {renderStars(value as number | null)}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            <Building2 size={48} className="mb-4 opacity-50" />
                            <p>Selecione um espaço para ver detalhes.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
