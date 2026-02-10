import React, { useState } from 'react';
import { CLUSTERS, INITIAL_COMPETITORS } from './constants';
import { EventCluster, Artist } from '../../types/centrovibe';
import { Card, Button, EmptyState } from '../ui';
import { Sparkles, XCircle, CheckCircle, ArrowLeft, MapPin, Users, Music } from 'lucide-react';

interface ClusterListProps {
  artists?: Artist[];
  competitors?: { id: string; name: string; neighborhood: string; capacity: number; mainClusters: string[]; priceRange: string }[];
}

const ClusterList: React.FC<ClusterListProps> = ({ artists = [], competitors }) => {
  const [selectedCluster, setSelectedCluster] = useState<EventCluster | null>(null);
  const competitorList = competitors || INITIAL_COMPETITORS;

  if (selectedCluster) {
    const cluster = CLUSTERS[selectedCluster];
    const Icon = cluster.icon;
    const styles = cluster.description.split('.')[0].split(',').map(s => s.trim());
    const relevantCompetitors = competitorList.filter(c => c.mainClusters.includes(selectedCluster));
    const relevantArtists = artists.filter(a => a.cluster === selectedCluster);

    return (
      <div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => setSelectedCluster(null)} className="mb-6">
          Voltar para Vibes
        </Button>

        <Card className={`mb-8 ${cluster.color.replace('text-white', 'bg-opacity-10')} relative overflow-hidden`} padding="lg">
          <div className={`absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl ${cluster.color} opacity-10 rounded-bl-full -mr-16 -mt-16 pointer-events-none`} />
          <div className="relative z-10 flex flex-col md:flex-row gap-6 items-start">
            <div className={`p-4 rounded-xl ${cluster.color} bg-opacity-20 shadow-xl`}>
              <Icon size={40} className="text-white" />
            </div>
            <div>
              <h2 className="text-3xl font-bold text-slate-800 dark:text-white mb-2">{cluster.label}</h2>
              <p className="text-slate-600 dark:text-slate-300 text-lg mb-4 max-w-2xl">{cluster.description}</p>
              <div className="flex flex-wrap gap-2">
                {styles.map((style, idx) => (
                  <span key={idx} className="text-xs uppercase font-bold px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-black/40 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white">{style}</span>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
              <MapPin className="text-indigo-500" /> Locais Relacionados
            </h3>
            <div className="space-y-3">
              {relevantCompetitors.length > 0 ? relevantCompetitors.map(comp => (
                <Card key={comp.id} hoverable>
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-bold text-slate-800 dark:text-white text-lg">{comp.name}</h4>
                      <p className="text-slate-500 dark:text-slate-400 text-sm mb-2">{comp.neighborhood}</p>
                      {comp.capacity > 0 && (
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] text-slate-500 font-mono">
                          <Users size={10} /> {comp.capacity} pax
                        </div>
                      )}
                    </div>
                    <div className="text-xs font-mono px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 uppercase">
                      {comp.priceRange === 'low' ? '$' : comp.priceRange === 'mid' ? '$$' : '$$$'}
                    </div>
                  </div>
                </Card>
              )) : (
                <EmptyState icon={MapPin} title="Nenhum concorrente mapeado" description="Nenhum concorrente mapeado para esta vibe." size="sm" />
              )}
            </div>
          </div>

          <div>
            <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
              <Music className="text-indigo-500" /> Casting Sugerido
            </h3>
            <div className="space-y-3">
              {relevantArtists.length > 0 ? relevantArtists.map(artist => (
                <Card key={artist.id} hoverable>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500">
                        {artist.role === 'dj' ? <Music size={16} /> : <Users size={16} />}
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-800 dark:text-white">{artist.name}</h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{artist.subGenre}</p>
                      </div>
                    </div>
                    <div className="text-green-600 dark:text-green-500 text-xs font-mono font-bold">{artist.rate || '$$'}</div>
                  </div>
                </Card>
              )) : (
                <EmptyState icon={Music} title="Nenhum artista cadastrado" description="Nenhum artista cadastrado para esta vibe." size="sm" />
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Sparkles className="text-indigo-500" /> Vibes & Clusters
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Guia de estilos e compatibilidade. Clique em um card para ver locais e artistas.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mb-8">
        {(Object.keys(CLUSTERS) as EventCluster[]).map((key) => {
          const cluster = CLUSTERS[key];
          const Icon = cluster.icon;
          const styles = cluster.description.split('.')[0].split(',').map(s => s.trim());

          return (
            <Card key={key} hoverable onClick={() => setSelectedCluster(key)} padding="none" className="overflow-hidden flex flex-col h-full">
              <div className={`h-2 w-full ${cluster.color.split(' ')[0]}`} />
              <div className="p-5 flex-1 flex flex-col w-full">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`p-3 rounded-lg ${cluster.color.replace('text-white', 'bg-opacity-10')} group-hover:bg-opacity-20 transition-all`}>
                    <Icon size={24} className={cluster.color.replace('bg-', 'text-').split(' ')[0]} />
                  </div>
                  <h3 className="text-lg font-bold text-slate-800 dark:text-white leading-tight group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{cluster.label}</h3>
                </div>
                <p className="text-slate-500 dark:text-slate-400 text-sm mb-4 flex-1">{cluster.description}</p>
                <div className="flex flex-wrap gap-2 mt-auto pt-4 border-t border-slate-200 dark:border-slate-800 w-full">
                  {styles.map((style, idx) => (
                    <span key={idx} className="text-[10px] uppercase font-bold px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 transition-colors">{style}</span>
                  ))}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-red-200 dark:border-red-900/30">
          <h3 className="text-lg font-bold text-red-600 dark:text-red-400 mb-4 flex items-center gap-2"><XCircle size={20} /> Zona de Perigo (Não Misturar)</h3>
          <ul className="space-y-4">
            <li className="flex gap-3 text-sm text-slate-600 dark:text-slate-400"><div className="w-1.5 h-1.5 mt-2 rounded-full bg-red-500 shrink-0" /><span><strong>Rock Clássico/Metal + Funk:</strong> Públicos antagonistas.</span></li>
            <li className="flex gap-3 text-sm text-slate-600 dark:text-slate-400"><div className="w-1.5 h-1.5 mt-2 rounded-full bg-red-500 shrink-0" /><span><strong>Samba Raiz + Techno:</strong> Quebra de clima.</span></li>
            <li className="flex gap-3 text-sm text-slate-600 dark:text-slate-400"><div className="w-1.5 h-1.5 mt-2 rounded-full bg-red-500 shrink-0" /><span><strong>Sertanejo + Hip Hop Purista:</strong> Choque cultural.</span></li>
          </ul>
        </Card>
        <Card className="border-emerald-200 dark:border-green-900/30">
          <h3 className="text-lg font-bold text-emerald-600 dark:text-green-400 mb-4 flex items-center gap-2"><CheckCircle size={20} /> Combinações de Sucesso</h3>
          <ul className="space-y-4">
            <li className="flex gap-3 text-sm text-slate-600 dark:text-slate-400"><div className="w-1.5 h-1.5 mt-2 rounded-full bg-green-500 shrink-0" /><span><strong>Samba + Funk:</strong> Transição natural do brasileiro.</span></li>
            <li className="flex gap-3 text-sm text-slate-600 dark:text-slate-400"><div className="w-1.5 h-1.5 mt-2 rounded-full bg-green-500 shrink-0" /><span><strong>Reggaeton + Pop Internacional:</strong> Vibes dançantes similares.</span></li>
            <li className="flex gap-3 text-sm text-slate-600 dark:text-slate-400"><div className="w-1.5 h-1.5 mt-2 rounded-full bg-green-500 shrink-0" /><span><strong>Forró + Sertanejo:</strong> Público fiel, gasta bem no bar.</span></li>
          </ul>
        </Card>
      </div>
    </div>
  );
};

export default ClusterList;
