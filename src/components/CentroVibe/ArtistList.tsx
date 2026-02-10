import React, { useState } from 'react';
import { Artist, ArtistRole, EventCluster } from '../../types/centrovibe';
import { CLUSTERS } from './constants';
import { Card, Button, Input, Modal } from '../ui';
import { Mic2, Disc, Settings, Users, Plus, Search, Instagram } from 'lucide-react';

interface ArtistListProps {
  artists: Artist[];
  onAddArtist: (artist: Artist) => void;
}

const ArtistList: React.FC<ArtistListProps> = ({ artists, onAddArtist }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [filterCluster, setFilterCluster] = useState<EventCluster | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<ArtistRole>('dj');
  const [newCluster, setNewCluster] = useState<EventCluster>('brasil_raiz');
  const [newSubGenre, setNewSubGenre] = useState('');
  const [newIg, setNewIg] = useState('');

  const handleAddArtist = () => {
    if (!newName) return;
    const newArtist: Artist = {
      id: Date.now().toString(),
      name: newName,
      role: newRole,
      cluster: newCluster,
      subGenre: newSubGenre,
      instagram: newIg,
      rate: '$$'
    };
    onAddArtist(newArtist);
    setIsModalOpen(false);
    setNewName(''); setNewSubGenre(''); setNewIg('');
  };

  const filteredArtists = artists.filter(artist => {
    const matchesCluster = filterCluster === 'all' || artist.cluster === filterCluster;
    const matchesSearch = artist.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      artist.subGenre.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCluster && matchesSearch;
  });

  const getRoleIcon = (role: ArtistRole) => {
    switch (role) {
      case 'dj': return <Disc size={14} />;
      case 'band': return <Users size={14} />;
      case 'producer': return <Settings size={14} />;
      case 'performer': return <Mic2 size={14} />;
    }
  };

  return (
    <div>
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Users className="text-indigo-500" /> Casting & Parceiros
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">Gerencie bandas, DJs e produtoras por Cluster.</p>
        </div>
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => setIsModalOpen(true)}>
          Novo Talento
        </Button>
      </div>

      <div className="flex flex-col md:flex-row gap-4 mb-6 bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
        <div className="flex-1">
          <Input
            icon={<Search size={16} />}
            placeholder="Buscar nome ou gênero..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0">
          <button
            onClick={() => setFilterCluster('all')}
            className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap border transition-all ${filterCluster === 'all' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white border-slate-300 dark:border-slate-600 shadow-sm' : 'border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'}`}
          >
            Todos
          </button>
          {(Object.keys(CLUSTERS) as EventCluster[]).map(key => (
            <button
              key={key}
              onClick={() => setFilterCluster(key)}
              className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap border transition-all flex items-center gap-2 ${filterCluster === key ? `${CLUSTERS[key].color} border-transparent` : 'border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'}`}
            >
              {filterCluster === key && <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />}
              {CLUSTERS[key].label.split('/')[0]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredArtists.map(artist => {
          const cluster = CLUSTERS[artist.cluster];
          return (
            <Card key={artist.id} hoverable className="relative overflow-hidden">
              <div className={`absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl ${cluster.color} opacity-10 rounded-bl-full -mr-8 -mt-8`} />
              <div className="flex justify-between items-start mb-3">
                <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300">
                  {getRoleIcon(artist.role)}
                </div>
                <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider ${cluster.color}`}>
                  {cluster.label.split('/')[0]}
                </span>
              </div>
              <h3 className="font-bold text-lg text-slate-800 dark:text-white mb-1 truncate">{artist.name}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">{artist.subGenre}</p>
              <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-1 text-slate-400 dark:text-slate-500 hover:text-pink-500 transition-colors cursor-pointer">
                  <Instagram size={14} />
                  <span className="text-xs">{artist.instagram || '-'}</span>
                </div>
                <div className="flex text-green-600 dark:text-green-500 text-xs font-mono font-bold">{artist.rate || '$$'}</div>
              </div>
            </Card>
          );
        })}
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Adicionar Novo Talento" size="md">
        <div className="space-y-4">
          <Input
            label="Nome do Artista/Projeto"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Ex: DJ Cleiton"
          />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo</label>
              <select value={newRole} onChange={e => setNewRole(e.target.value as ArtistRole)}
                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500">
                <option value="dj">DJ</option>
                <option value="band">Banda</option>
                <option value="producer">Produtora</option>
                <option value="performer">Performer</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cluster (Vibe)</label>
              <select value={newCluster} onChange={e => setNewCluster(e.target.value as EventCluster)}
                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500">
                {Object.keys(CLUSTERS).map(k => (
                  <option key={k} value={k}>{CLUSTERS[k as EventCluster].label}</option>
                ))}
              </select>
            </div>
          </div>
          <Input
            label="Sub-gênero"
            value={newSubGenre}
            onChange={e => setNewSubGenre(e.target.value)}
            placeholder="Ex: Pagode 90, Techno"
          />
          <Input
            label="Instagram"
            icon={<Instagram size={16} />}
            value={newIg}
            onChange={e => setNewIg(e.target.value)}
            placeholder="@usuario"
          />
          <Button variant="primary" fullWidth onClick={handleAddArtist}>
            Cadastrar
          </Button>
        </div>
      </Modal>
    </div>
  );
};

export default ArtistList;
