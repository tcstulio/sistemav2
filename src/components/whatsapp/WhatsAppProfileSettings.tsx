
import React, { useState, useEffect, useRef } from 'react';
import { WhatsAppService } from '../../services/whatsappService';
import { WhatsAppProfile } from '../../types/whatsapp';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { User, Camera, Trash2, RefreshCw, Save, Smartphone } from 'lucide-react';
import { logger } from '../../utils/logger';
import { notifyError } from '../../utils/notifyError';
import { toast } from 'sonner';
import { useConfirm } from '../../hooks/useConfirm';

const log = logger.child('WhatsAppProfileSettings');

interface WhatsAppProfileSettingsProps {
    sessionId?: string;
}

export const WhatsAppProfileSettings: React.FC<WhatsAppProfileSettingsProps> = ({ sessionId = 'default' }) => {
    const [profile, setProfile] = useState<WhatsAppProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const confirm = useConfirm();
    const [saving, setSaving] = useState(false);

    // Form States (buffered)
    const [nameDraft, setNameDraft] = useState('');
    const [aboutDraft, setAboutDraft] = useState('');

    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchProfile = async () => {
        try {
            setLoading(true);
            const data = await WhatsAppService.getProfile(sessionId);
            setProfile(data);
            setNameDraft(data.name || '');
            setAboutDraft(data.about || '');
        } catch (error) {
            log.error("Failed to fetch profile", error);
            // Optionally show error toast
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchProfile();
    }, [sessionId]);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            try {
                setSaving(true);
                await WhatsAppService.setProfilePicture(e.target.files[0], sessionId);
                await fetchProfile(); // Refresh to get new URL
            } catch (error) {
                log.error("Failed to change picture", error);
            } finally {
                setSaving(false);
            }
        }
    };

    const handleDeletePicture = async () => {
        if (!(await confirm('Tem certeza que deseja remover a foto de perfil?'))) return;
        try {
            setSaving(true);
            await WhatsAppService.deleteProfilePicture(sessionId);
            await fetchProfile();
        } catch (error) {
            log.error("Failed to delete picture", error);
        } finally {
            setSaving(false);
        }
    };

    const handleSaveName = async () => {
        try {
            setSaving(true);
            await WhatsAppService.setDisplayName(nameDraft, sessionId);
            // Update local state to reflect saved
            setProfile(prev => prev ? { ...prev, name: nameDraft } : null);
            toast.success('Nome atualizado com sucesso!');
        } catch (error) {
            notifyError('Atualizar nome', error);
        } finally {
            setSaving(false);
        }
    };

    const handleSaveAbout = async () => {
        try {
            setSaving(true);
            await WhatsAppService.setAbout(aboutDraft, sessionId);
            setProfile(prev => prev ? { ...prev, about: aboutDraft } : null);
            toast.success('Recado atualizado com sucesso!');
        } catch (error) {
            notifyError('Atualizar recado', error);
        } finally {
            setSaving(false);
        }
    };

    const handlePresence = async (presence: 'online' | 'offline') => {
        try {
            await WhatsAppService.setPresence(presence, sessionId);
            toast.success(`Definido como ${presence === 'online' ? 'Online' : 'Offline'}`);
        } catch (error) {
            log.error("Failed to set presence", error);
        }
    };

    if (loading && !profile) {
        return <div className="p-4 text-center">Carregando perfil...</div>;
    }

    if (!profile) {
        return (
            <div className="p-4 text-center text-red-500">
                Não foi possível carregar o perfil. Verifique se a sessão está conectada.
                <Button onClick={fetchProfile} variant="outline" className="mt-2 ml-2">Tentar Novamente</Button>
            </div>
        );
    }

    return (
        <Card className="max-w-2xl mx-auto">
            <div className="p-6 space-y-8">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                        <User className="w-5 h-5" /> Perfil do WhatsApp
                    </h2>
                    <Button variant="ghost" size="sm" onClick={fetchProfile} disabled={loading}>
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </Button>
                </div>

                {/* Profile Picture Section */}
                <div className="flex flex-col items-center gap-4">
                    <div className="relative group">
                        {profile.profilePicUrl ? (
                            <img
                                src={profile.profilePicUrl}
                                alt="Profile"
                                className="w-32 h-32 rounded-full object-cover border-4 border-slate-100 shadow-md"
                            />
                        ) : (
                            <div className="w-32 h-32 rounded-full bg-slate-200 flex items-center justify-center border-4 border-slate-100 shadow-md">
                                <User className="w-16 h-16 text-slate-400" />
                            </div>
                        )}
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            accept="image/*"
                            onChange={handleFileChange}
                        />

                    </div>
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={saving}
                        >
                            <Camera className="w-4 h-4 mr-2" /> Alterar Foto
                        </Button>
                        {profile.profilePicUrl && (
                            <Button
                                size="sm"
                                variant="danger"
                                onClick={handleDeletePicture}
                                disabled={saving}
                            >
                                <Trash2 className="w-4 h-4 mr-2" /> Remover
                            </Button>
                        )}
                    </div>
                </div>

                <div className="space-y-4">
                    {/* Display Name */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700">Nome de Exibição (Pushname)</label>
                        <div className="flex gap-2">
                            <Input
                                value={nameDraft}
                                onChange={(e) => setNameDraft(e.target.value)}
                                placeholder="Seu nome público"
                            />
                            <Button onClick={handleSaveName} disabled={saving || nameDraft === profile.name}>
                                <Save className="w-4 h-4" />
                            </Button>
                        </div>
                        <p className="text-xs text-slate-500">Este nome aparecerá para contatos que não têm seu número salvo.</p>
                    </div>

                    {/* About / Status */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700">Recado (Bio)</label>
                        <div className="flex gap-2">
                            <Input
                                value={aboutDraft}
                                onChange={(e) => setAboutDraft(e.target.value)}
                                placeholder="Dormindo, No Trabalho, etc."
                            />
                            <Button onClick={handleSaveAbout} disabled={saving || aboutDraft === profile.about}>
                                <Save className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>

                    {/* Number Info (Read Only) */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700">Número Conectado</label>
                        <div className="p-2 bg-slate-50 rounded border text-slate-600">
                            {profile.number.split('@')[0]}
                        </div>
                    </div>

                    {/* Presence Control */}
                    <div className="pt-4 border-t">
                        <label className="text-sm font-medium text-slate-700 block mb-3">Controle de Presença</label>
                        <div className="flex gap-3">
                            <Button variant="outline" className="w-full" onClick={() => handlePresence('online')}>
                                <Smartphone className="w-4 h-4 mr-2 text-green-500" /> Forçar Online
                            </Button>
                            <Button variant="outline" className="w-full" onClick={() => handlePresence('offline')}>
                                <Smartphone className="w-4 h-4 mr-2 text-slate-400" /> Forçar Offline
                            </Button>
                        </div>
                        <p className="text-xs text-slate-500 mt-2">Define o status "Online" manualmente. O status volta ao normal quando você interage com o WhatsApp.</p>
                    </div>
                </div>
            </div>
        </Card>
    );
};
