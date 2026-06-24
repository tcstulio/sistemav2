import React, { useState, useMemo, useEffect } from 'react';
import { sanitizeHtml } from '../utils/sanitizeHtml';
import { Building2, MapPin, Users, Star, DollarSign, ExternalLink, Globe, Phone, Mail, Calendar, PartyPopper, Briefcase, Music, Loader2, Plus, Pencil, Trash2 } from 'lucide-react';
import { useDolibarr } from '../context/DolibarrContext';
import { useListControls } from '../hooks/useListControls';
import {
    VenuePartnership,
    getMaxCapacity,
    getAverageRating,
    getBestPrice,
    formatCapacity,
    RatingLabels,
    PricingLabels
} from '../types/venue';
import { fetchList } from '../services/api/core';
import { createVenue, updateVenue, deleteVenue, VenuePayload } from '../services/api/venues';
import { getThirdParty } from '../services/api/commercial';
import { formatCurrency } from '../utils/formatUtils';
import { AppView } from '../types';
import { formatDateOnly } from '../utils/dateUtils';
import { logger } from '../utils/logger';

const log = logger.child('VenueList');

// Design System
import { PageHeader, MasterDetailLayout, Card, Button, Tabs, Tab, EmptyState, ListToolbar, Modal, ConfirmModal, Input } from './ui';

interface VenueListProps {
    onNavigate?: (view: AppView, id: string) => void;
    onSelectVenue?: (venue: VenuePartnership) => void;
    initialItemId?: string;
}

// ---- Form state ----
interface VenueFormData {
    nome: string;
    descricao: string;
    endereco: string;
    site: string;
    whatsapp: string;
    email: string;
    lotacaoEmPe: string;
    lotacaoMesaJantar: string;
    lotacaoMesaPequena: string;
    qtdePessoas: string;
    precoSemana: string;
    precoFimSemana: string;
    precoCorporativo: string;
    precoFesta: string;
    precoCultural: string;
    precoParceria: string;
    pacoteDatas: string;
}

interface VenueFormErrors {
    nome?: string;
    email?: string;
    site?: string;
    lotacaoEmPe?: string;
    lotacaoMesaJantar?: string;
    lotacaoMesaPequena?: string;
    qtdePessoas?: string;
    precoSemana?: string;
    precoFimSemana?: string;
    precoCorporativo?: string;
    precoFesta?: string;
    precoCultural?: string;
    precoParceria?: string;
    pacoteDatas?: string;
}

const emptyForm = (): VenueFormData => ({
    nome: '',
    descricao: '',
    endereco: '',
    site: '',
    whatsapp: '',
    email: '',
    lotacaoEmPe: '',
    lotacaoMesaJantar: '',
    lotacaoMesaPequena: '',
    qtdePessoas: '',
    precoSemana: '',
    precoFimSemana: '',
    precoCorporativo: '',
    precoFesta: '',
    precoCultural: '',
    precoParceria: '',
    pacoteDatas: '',
});

const venueToForm = (v: VenuePartnership): VenueFormData => ({
    nome: v.name || '',
    descricao: v.description || '',
    endereco: v.contact.address || '',
    site: v.contact.site || '',
    whatsapp: v.contact.whatsapp || '',
    email: v.contact.email || '',
    lotacaoEmPe: v.capacity.standing != null ? String(v.capacity.standing) : '',
    lotacaoMesaJantar: v.capacity.dinnerTable != null ? String(v.capacity.dinnerTable) : '',
    lotacaoMesaPequena: v.capacity.smallTable != null ? String(v.capacity.smallTable) : '',
    qtdePessoas: v.capacity.reference != null ? String(v.capacity.reference) : '',
    precoSemana: v.pricing.weekday != null ? String(v.pricing.weekday) : '',
    precoFimSemana: v.pricing.weekend != null ? String(v.pricing.weekend) : '',
    precoCorporativo: v.pricing.corporate != null ? String(v.pricing.corporate) : '',
    precoFesta: v.pricing.party != null ? String(v.pricing.party) : '',
    precoCultural: v.pricing.cultural != null ? String(v.pricing.cultural) : '',
    precoParceria: v.pricing.partnership != null ? String(v.pricing.partnership) : '',
    pacoteDatas: v.pricing.package != null ? String(v.pricing.package) : '',
});

const formToPayload = (f: VenueFormData, fkSoc?: string): VenuePayload => {
    const numOpt = (v: string) => (v.trim() !== '' ? v.trim() : undefined);
    return {
        fk_soc: fkSoc || '0',
        array_options: {
            options_nome_espaco: f.nome.trim() || undefined,
            options_descreva: f.descricao.trim() || undefined,
            options_endereco: f.endereco.trim() || undefined,
            options_site: f.site.trim() || undefined,
            options_whatsapp: f.whatsapp.trim() || undefined,
            options_email: f.email.trim() || undefined,
            options_lotacao_em_pe: numOpt(f.lotacaoEmPe),
            options_lotacao_mesa_jantar: numOpt(f.lotacaoMesaJantar),
            options_lotacao_mesa_pequena: numOpt(f.lotacaoMesaPequena),
            options_quantidade_pessoas: numOpt(f.qtdePessoas),
            options_negociacao_dia_da_semana: numOpt(f.precoSemana),
            options_negociacao_final_de_semana: numOpt(f.precoFimSemana),
            options_negociacao_corporativo: numOpt(f.precoCorporativo),
            options_negociacao_festa: numOpt(f.precoFesta),
            options_negociacao_cultural: numOpt(f.precoCultural),
            options_negociacao_parceria: numOpt(f.precoParceria),
            options_negociacao_pacote_datas: numOpt(f.pacoteDatas),
        },
    };
};

const validateForm = (f: VenueFormData): VenueFormErrors => {
    const errors: VenueFormErrors = {};

    if (!f.nome.trim()) {
        errors.nome = 'Nome do espaço é obrigatório';
    }

    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) {
        errors.email = 'E-mail inválido';
    }

    if (f.site.trim() && !/^https?:\/\/.+/.test(f.site.trim())) {
        errors.site = 'Site deve começar com http:// ou https://';
    }

    const numFields: (keyof VenueFormErrors & keyof VenueFormData)[] = [
        'lotacaoEmPe', 'lotacaoMesaJantar', 'lotacaoMesaPequena', 'qtdePessoas',
        'precoSemana', 'precoFimSemana', 'precoCorporativo', 'precoFesta',
        'precoCultural', 'precoParceria', 'pacoteDatas',
    ];
    for (const field of numFields) {
        const v = f[field] as string;
        if (v.trim() !== '' && (isNaN(Number(v)) || Number(v) < 0)) {
            errors[field] = 'Deve ser um número válido';
        }
    }

    return errors;
};

// ---- Main component ----

export const VenueList: React.FC<VenueListProps> = ({ onNavigate, onSelectVenue, initialItemId }) => {
    const { config, canDo } = useDolibarr();
    const [venues, setVenues] = useState<VenuePartnership[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [selectedVenue, setSelectedVenue] = useState<VenuePartnership | null>(null);
    const [activeTab, setActiveTab] = useState<'overview' | 'capacity' | 'pricing' | 'ratings'>('overview');
    const [clientName, setClientName] = useState<string | null>(null);

    // CRUD modal state
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingVenue, setEditingVenue] = useState<VenuePartnership | null>(null);
    const [formData, setFormData] = useState<VenueFormData>(emptyForm());
    const [formErrors, setFormErrors] = useState<VenueFormErrors>({});
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    // Delete confirmation state
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const fetchVenues = async () => {
        if (!config) return;
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetchList(config, 'partnerships/partnerships');
            const transformed = (response || []).map((p: any) => transformPartnership(p));
            setVenues(transformed);
        } catch (e: any) {
            log.error('Erro ao buscar espaços:', e);
            setError(e.message || 'Erro ao buscar espaços');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchVenues();
    }, [config]);

    useEffect(() => {
        if (initialItemId && venues.length > 0) {
            const target = venues.find(v => String(v.id) === String(initialItemId));
            if (target) {
                setSelectedVenue(target);
                setActiveTab('overview');
            }
        }
    }, [initialItemId, venues]);

    useEffect(() => {
        if (!selectedVenue || !config) {
            setClientName(null);
            return;
        }
        if (!selectedVenue.fkSoc || selectedVenue.fkSoc === '0') {
            setClientName(null);
            return;
        }
        let cancelled = false;
        getThirdParty(config, String(selectedVenue.fkSoc))
            .then((tp: any) => { if (!cancelled) setClientName(tp?.name || String(selectedVenue.fkSoc)); })
            .catch(() => { if (!cancelled) setClientName(String(selectedVenue.fkSoc)); });
        return () => { cancelled = true; };
    }, [selectedVenue, config]);

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

    const venueTypes = useMemo(() => {
        const types = new Map<string, string>();
        venues.forEach(v => {
            if (v.typeCode && v.typeLabel) {
                types.set(v.typeCode, v.typeLabel);
            }
        });
        return Array.from(types.entries());
    }, [venues]);

    // Busca + ordenação + filtro de tipo padronizados (#121).
    const controls = useListControls(venues, {
        searchText: (v) => `${v.name || ''} ${v.description || ''} ${v.typeLabel || ''}`,
        sorts: [
            { key: 'name', label: 'Nome', get: (v) => v.name },
            { key: 'capacity', label: 'Capacidade', get: (v) => getMaxCapacity(v) || 0 },
            { key: 'rating', label: 'Avaliação', get: (v) => getAverageRating(v) || 0 },
            { key: 'price', label: 'Preço', get: (v) => getBestPrice(v) ?? 0 },
        ],
        filters: [
            { key: 'typeCode', label: 'Tipo', get: (v) => v.typeCode, options: venueTypes.map(([code, label]) => ({ value: code, label })) },
        ],
        initialSortKey: 'name',
    });
    const filteredVenues = controls.result;

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

    const formatPrice = (price: number | null) => {
        if (price === null) return 'Sob consulta';
        return formatCurrency(price);
    };

    const handleSelectForSimulator = () => {
        if (selectedVenue && onSelectVenue) {
            onSelectVenue(selectedVenue);
        }
    };

    // ---- CRUD handlers ----

    const openCreateForm = () => {
        setEditingVenue(null);
        setFormData(emptyForm());
        setFormErrors({});
        setSaveError(null);
        setIsFormOpen(true);
    };

    const openEditForm = () => {
        if (!selectedVenue) return;
        setEditingVenue(selectedVenue);
        setFormData(venueToForm(selectedVenue));
        setFormErrors({});
        setSaveError(null);
        setIsFormOpen(true);
    };

    const closeForm = () => {
        setIsFormOpen(false);
        setEditingVenue(null);
    };

    const handleFormChange = (field: keyof VenueFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setFormData(prev => ({ ...prev, [field]: e.target.value }));
        // Clear field error on change
        if (formErrors[field as keyof VenueFormErrors]) {
            setFormErrors(prev => ({ ...prev, [field]: undefined }));
        }
    };

    const handleFormSubmit = async () => {
        if (!config) return;

        const errors = validateForm(formData);
        if (Object.keys(errors).length > 0) {
            setFormErrors(errors);
            return;
        }

        setIsSaving(true);
        setSaveError(null);
        try {
            const payload = formToPayload(formData, editingVenue?.fkSoc);
            if (editingVenue) {
                await updateVenue(config, String(editingVenue.id), payload);
            } else {
                await createVenue(config, payload);
            }
            closeForm();
            // Reload list and update detail if editing
            await fetchVenues();
            if (editingVenue) {
                // selectedVenue will be refreshed via state after fetchVenues
                setSelectedVenue(null);
            }
        } catch (e: any) {
            log.error('Erro ao salvar espaço:', e);
            setSaveError(e.message || 'Erro ao salvar espaço');
        } finally {
            setIsSaving(false);
        }
    };

    const openDeleteConfirm = () => {
        setIsDeleteOpen(true);
    };

    const handleDeleteConfirm = async () => {
        if (!config || !selectedVenue) return;
        setIsDeleting(true);
        setError(null);
        try {
            await deleteVenue(config, String(selectedVenue.id));
            setIsDeleteOpen(false);
            setSelectedVenue(null);
            await fetchVenues();
        } catch (e: any) {
            log.error('Erro ao excluir espaço:', e);
            setError(e.message || 'Erro ao excluir espaço');
            setIsDeleteOpen(false);
        } finally {
            setIsDeleting(false);
        }
    };

    if (!config) return null;

    // ---- Venue Form Modal ----

    const renderFormModal = (
        <Modal
            isOpen={isFormOpen}
            onClose={closeForm}
            title={editingVenue ? 'Editar Espaço' : 'Novo Espaço'}
            size="lg"
            footer={
                <>
                    <Button variant="ghost" onClick={closeForm} disabled={isSaving}>
                        Cancelar
                    </Button>
                    <Button
                        variant="primary"
                        onClick={handleFormSubmit}
                        loading={isSaving}
                        data-testid="venue-form-submit"
                    >
                        {editingVenue ? 'Salvar Alterações' : 'Criar Espaço'}
                    </Button>
                </>
            }
        >
            {saveError && (
                <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400" role="alert">
                    {saveError}
                </div>
            )}
            <div className="space-y-5">
                <section>
                    <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-3">Identificação</h3>
                    <div className="space-y-3">
                        <Input
                            label="Nome do Espaço *"
                            placeholder="Ex.: Salão Imperial"
                            value={formData.nome}
                            onChange={handleFormChange('nome')}
                            error={formErrors.nome}
                            data-testid="venue-input-nome"
                        />
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Descrição
                            </label>
                            <textarea
                                className="w-full p-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors resize-y min-h-[80px]"
                                placeholder="Descreva o espaço..."
                                value={formData.descricao}
                                onChange={handleFormChange('descricao')}
                            />
                        </div>
                    </div>
                </section>

                <section>
                    <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-3">Contato</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Input
                            label="Endereço"
                            placeholder="Rua, número, cidade"
                            value={formData.endereco}
                            onChange={handleFormChange('endereco')}
                            icon={<MapPin size={14} />}
                        />
                        <Input
                            label="WhatsApp"
                            placeholder="+55 11 99999-9999"
                            value={formData.whatsapp}
                            onChange={handleFormChange('whatsapp')}
                            icon={<Phone size={14} />}
                        />
                        <Input
                            label="E-mail"
                            type="email"
                            placeholder="contato@espaco.com"
                            value={formData.email}
                            onChange={handleFormChange('email')}
                            error={formErrors.email}
                            icon={<Mail size={14} />}
                        />
                        <Input
                            label="Site"
                            placeholder="https://espaco.com"
                            value={formData.site}
                            onChange={handleFormChange('site')}
                            error={formErrors.site}
                            icon={<Globe size={14} />}
                        />
                    </div>
                </section>

                <section>
                    <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-3">Capacidade</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Input
                            label="Em pé"
                            type="number"
                            min="0"
                            placeholder="0"
                            value={formData.lotacaoEmPe}
                            onChange={handleFormChange('lotacaoEmPe')}
                            error={formErrors.lotacaoEmPe}
                        />
                        <Input
                            label="Mesa Jantar"
                            type="number"
                            min="0"
                            placeholder="0"
                            value={formData.lotacaoMesaJantar}
                            onChange={handleFormChange('lotacaoMesaJantar')}
                            error={formErrors.lotacaoMesaJantar}
                        />
                        <Input
                            label="Mesa Coquetel"
                            type="number"
                            min="0"
                            placeholder="0"
                            value={formData.lotacaoMesaPequena}
                            onChange={handleFormChange('lotacaoMesaPequena')}
                            error={formErrors.lotacaoMesaPequena}
                        />
                        <Input
                            label="Referência"
                            type="number"
                            min="0"
                            placeholder="0"
                            value={formData.qtdePessoas}
                            onChange={handleFormChange('qtdePessoas')}
                            error={formErrors.qtdePessoas}
                        />
                    </div>
                </section>

                <section>
                    <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-3">Preços (R$)</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Input
                            label="Dia de Semana"
                            type="number"
                            min="0"
                            placeholder="0,00"
                            value={formData.precoSemana}
                            onChange={handleFormChange('precoSemana')}
                            error={formErrors.precoSemana}
                        />
                        <Input
                            label="Fim de Semana"
                            type="number"
                            min="0"
                            placeholder="0,00"
                            value={formData.precoFimSemana}
                            onChange={handleFormChange('precoFimSemana')}
                            error={formErrors.precoFimSemana}
                        />
                        <Input
                            label="Corporativo"
                            type="number"
                            min="0"
                            placeholder="0,00"
                            value={formData.precoCorporativo}
                            onChange={handleFormChange('precoCorporativo')}
                            error={formErrors.precoCorporativo}
                        />
                        <Input
                            label="Festa"
                            type="number"
                            min="0"
                            placeholder="0,00"
                            value={formData.precoFesta}
                            onChange={handleFormChange('precoFesta')}
                            error={formErrors.precoFesta}
                        />
                        <Input
                            label="Cultural"
                            type="number"
                            min="0"
                            placeholder="0,00"
                            value={formData.precoCultural}
                            onChange={handleFormChange('precoCultural')}
                            error={formErrors.precoCultural}
                        />
                        <Input
                            label="Parceria"
                            type="number"
                            min="0"
                            placeholder="0,00"
                            value={formData.precoParceria}
                            onChange={handleFormChange('precoParceria')}
                            error={formErrors.precoParceria}
                        />
                        <Input
                            label="Pacote Datas"
                            type="number"
                            min="0"
                            placeholder="0,00"
                            value={formData.pacoteDatas}
                            onChange={handleFormChange('pacoteDatas')}
                            error={formErrors.pacoteDatas}
                        />
                    </div>
                </section>
            </div>
        </Modal>
    );

    // ---- Header / List / Detail ----

    const renderHeader = (
        <div className={selectedVenue ? 'hidden lg:block' : 'block'}>
            <PageHeader
                title={
                    <span className="flex items-center gap-2">
                        <Building2 className="text-indigo-600" size={24} />
                        Espaços de Eventos
                    </span>
                }
                subtitle={`${venues.length} espaços cadastrados`}
                actions={
                    <div className="flex items-center gap-2">
                        {canDo('create', 'venues') && (
                        <Button
                            size="sm"
                            icon={<Plus size={16} />}
                            onClick={openCreateForm}
                            data-testid="btn-novo-espaco"
                        >
                            Novo espaço
                        </Button>
                        )}
                        <ListToolbar controls={controls} searchPlaceholder="Buscar espaços..." />
                    </div>
                }
            />
        </div>
    );

    const renderList = (
        <div className="p-4 md:p-6">
            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                    <Loader2 size={48} className="animate-spin mb-4" />
                    <p>Carregando espaços...</p>
                </div>
            ) : error ? (
                <div className="text-center py-20 text-red-500" role="alert">
                    <p>{error}</p>
                </div>
            ) : filteredVenues.length === 0 ? (
                <EmptyState icon={Building2} title="Nenhum espaço encontrado" description="Tente ajustar a busca." />
            ) : (
                <div className="space-y-4">
                    {filteredVenues.map(venue => (
                        <Card
                            key={venue.id}
                            onClick={() => setSelectedVenue(venue)}
                            selected={selectedVenue?.id === venue.id}
                            className="cursor-pointer"
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
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );

    const renderDetail = selectedVenue ? (
        <>
            <PageHeader
                onBack={() => setSelectedVenue(null)}
                title={selectedVenue.name}
                subtitle={`${selectedVenue.typeLabel} • ${selectedVenue.ref}`}
                actions={
                    <div className="flex items-center gap-2">
                        {onSelectVenue && (
                            <Button size="sm" icon={<PartyPopper size={16} />} onClick={handleSelectForSimulator}>
                                Usar no Simulador
                            </Button>
                        )}
                        {canDo('edit', 'venues') && (
                        <Button
                            size="sm"
                            variant="outline"
                            icon={<Pencil size={16} />}
                            onClick={openEditForm}
                            data-testid="btn-editar-espaco"
                        >
                            Editar
                        </Button>
                        )}
                        {canDo('delete', 'venues') && (
                        <Button
                            size="sm"
                            variant="danger"
                            icon={<Trash2 size={16} />}
                            onClick={openDeleteConfirm}
                            data-testid="btn-excluir-espaco"
                        >
                            Excluir
                        </Button>
                        )}
                    </div>
                }
                tabs={
                    <Tabs value={activeTab} onChange={(v) => setActiveTab(v as any)}>
                        <Tab value="overview">Visão Geral</Tab>
                        <Tab value="capacity">Capacidade</Tab>
                        <Tab value="pricing">Preços</Tab>
                        <Tab value="ratings">Avaliações</Tab>
                    </Tabs>
                }
            />

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950/50">
                <div className="max-w-3xl mx-auto space-y-6">
                    {activeTab === 'overview' && (
                        <>
                            {selectedVenue.description && (
                                <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                    <h3 className="font-bold text-slate-800 dark:text-white mb-3">Descrição</h3>
                                    <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed"
                                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(selectedVenue.description.replace(/\n/g, '<br/>')) }}
                                    />
                                </div>
                            )}

                            {(selectedVenue.fkSoc && selectedVenue.fkSoc !== '0') && (
                                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-3">
                                    <Building2 size={18} className="text-indigo-400 shrink-0" />
                                    <div>
                                        <div className="text-xs text-slate-500 mb-0.5">Cliente / Empresa</div>
                                        <div className="text-sm font-medium text-slate-800 dark:text-white">
                                            {clientName ?? '—'}
                                        </div>
                                    </div>
                                </div>
                            )}

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

                            {selectedVenue.notes && (
                                <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-xl border border-amber-200 dark:border-amber-800">
                                    <h4 className="font-medium text-amber-800 dark:text-amber-200 mb-2 text-sm">Observações Internas</h4>
                                    <p className="text-amber-700 dark:text-amber-300 text-sm">{selectedVenue.notes}</p>
                                </div>
                            )}

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
                                    <div className="text-3xl font-bold text-slate-800 dark:text-white">{selectedVenue.capacity.standing || '-'}</div>
                                    <div className="text-sm text-slate-500 mt-1">Em pé</div>
                                </div>
                                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                                    <div className="text-3xl font-bold text-slate-800 dark:text-white">{selectedVenue.capacity.dinnerTable || '-'}</div>
                                    <div className="text-sm text-slate-500 mt-1">Mesa de Jantar</div>
                                </div>
                                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                                    <div className="text-3xl font-bold text-slate-800 dark:text-white">{selectedVenue.capacity.smallTable || '-'}</div>
                                    <div className="text-sm text-slate-500 mt-1">Mesa Coquetel</div>
                                </div>
                                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                                    <div className="text-3xl font-bold text-slate-800 dark:text-white">{selectedVenue.capacity.reference || '-'}</div>
                                    <div className="text-sm text-slate-500 mt-1">Referência</div>
                                </div>
                            </div>

                            {selectedVenue.includedServices.length > 0 && (
                                <div className="mt-6 pt-6 border-t border-slate-100 dark:border-slate-800">
                                    <h4 className="font-medium text-slate-800 dark:text-white mb-3">Serviços Inclusos</h4>
                                    <div className="flex flex-wrap gap-2">
                                        {selectedVenue.includedServices.map((service, idx) => (
                                            <span key={idx} className="px-2 py-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded text-xs">
                                                {service}
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
    ) : null;

    return (
        <div className="flex flex-col h-full">
            {renderHeader}
            <MasterDetailLayout
                list={renderList}
                detail={renderDetail}
                showDetail={!!selectedVenue}
                onCloseDetail={() => setSelectedVenue(null)}
            />

            {/* Form Modal (create / edit) */}
            {renderFormModal}

            {/* Delete confirmation */}
            <ConfirmModal
                isOpen={isDeleteOpen}
                onClose={() => setIsDeleteOpen(false)}
                onConfirm={handleDeleteConfirm}
                title="Excluir Espaço"
                message={`Tem certeza que deseja excluir "${selectedVenue?.name}"? Esta ação não pode ser desfeita.`}
                confirmLabel="Excluir"
                isLoading={isDeleting}
                variant="danger"
            />
        </div>
    );
};
