import { DaySchedule, EventCluster, Season, Artist, Competitor, ExternalEvent } from '../../types/centrovibe';
import { Music, Zap, Heart, Globe, Shuffle, Mic2 } from 'lucide-react';

export const CLUSTERS: Record<EventCluster, { label: string; color: string; icon: React.ElementType; description: string }> = {
  brasil_raiz: {
    label: "Brasil Raiz/Boêmio",
    color: "bg-amber-600 text-white",
    icon: Music,
    description: "Samba, Pagode, MPB, Forró. Público democrático."
  },
  urbano_hype: {
    label: "Urbano & Hype",
    color: "bg-indigo-600 text-white",
    icon: Zap,
    description: "Funk, Trap, Hip Hop, Grime. Público jovem."
  },
  latinidades: {
    label: "Latinidades",
    color: "bg-red-600 text-white",
    icon: Globe,
    description: "Reggaeton, Salsa, Bachata. Imigrantes e dançantes."
  },
  povao_coracao: {
    label: "Povão/Coração",
    color: "bg-pink-600 text-white",
    icon: Heart,
    description: "Sertanejo, Piseiro, Arrocha. Cantar junto."
  },
  open_format: {
    label: "Open Format/Caos",
    color: "bg-blue-600 text-white",
    icon: Shuffle,
    description: "Mistura de Hits. Pop, Sertanejo, Funk."
  },
  eclectic: {
    label: "Eclético/Outros",
    color: "bg-slate-600 text-white",
    icon: Mic2,
    description: "Jazz, Instrumental, Chill."
  }
};

export const SEASONS: Season[] = [
  {
    id: 'summer',
    months: [0, 1, 2],
    label: "Verão / Carnaval",
    theme: "Brasil Tropical",
    color: "from-yellow-500 to-orange-500",
    description: "Axé retrô, Marchinhas, Remixes de Brasilidades, Funk carioca."
  },
  {
    id: 'autumn',
    months: [3, 4],
    label: "Outono / Festival Season",
    theme: "Indie & Pop Alternative",
    color: "from-orange-500 to-red-500",
    description: "Pop Internacional, Indie Rock, Eletro-Pop (Vibe Lollapalooza)."
  },
  {
    id: 'winter',
    months: [5, 6],
    label: "Inverno / Junina",
    theme: "Arraiá Urbano",
    color: "from-blue-500 to-indigo-500",
    description: "Sertanejo, Xote, Forró, Quentão."
  },
  {
    id: 'spring',
    months: [7, 8, 9],
    label: "Primavera / Pré-Verão",
    theme: "Baile Funk & Trap",
    color: "from-pink-500 to-indigo-500",
    description: "Trap nacional, Funk SP (Mandela) e Funk RJ (150bpm)."
  },
  {
    id: 'eoy',
    months: [10, 11],
    label: "Fim de Ano",
    theme: "Retrospectiva & Nostalgia",
    color: "from-indigo-400 to-indigo-600",
    description: "Festa da Firma, Flashback Anos 2000, Hits do Ano."
  }
];

export const INITIAL_ARTISTS: Artist[] = [
  { id: '1', name: 'DJ Cleiton Rasta', role: 'dj', cluster: 'brasil_raiz', subGenre: 'Deboche / Forró', instagram: '@cleiton', rate: '$$' },
  { id: '2', name: 'Grupo Menos é Mais Cover', role: 'band', cluster: 'brasil_raiz', subGenre: 'Pagode', instagram: '@grupo', rate: '$$$' },
  { id: '3', name: 'MC Pipokinha Cover', role: 'performer', cluster: 'urbano_hype', subGenre: 'Funk Mandela', instagram: '@mc', rate: '$$' },
  { id: '4', name: 'DJ Latino Gang', role: 'dj', cluster: 'latinidades', subGenre: 'Reggaeton Old School', instagram: '@latinogang', rate: '$' },
  { id: '5', name: 'Coletivo Jazz SP', role: 'band', cluster: 'eclectic', subGenre: 'Jazz Fusion', instagram: '@jazzsp', rate: '$$' },
  { id: '6', name: 'Produtora Festa Estranha', role: 'producer', cluster: 'open_format', subGenre: 'Festas Temáticas', instagram: '@festaestranha', rate: '$$$$' },
];

export const INITIAL_COMPETITORS: Competitor[] = [
  { id: 'c1', name: 'Mundo Pensante', neighborhood: 'Bixiga', address: 'Rua 13 de Maio, 825', capacity: 600, mainClusters: ['brasil_raiz', 'urbano_hype'], priceRange: 'mid' },
  { id: 'c2', name: 'Tokyo', neighborhood: 'Centro', address: 'Rua Major Sertório, 110', capacity: 350, mainClusters: ['urbano_hype', 'open_format'], priceRange: 'high' },
  { id: 'c3', name: 'Casa da Luz', neighborhood: 'Luz', address: 'Rua Mauá, 512', capacity: 400, mainClusters: ['urbano_hype', 'eclectic'], priceRange: 'low' },
  { id: 'c4', name: 'Bar do Baixo', neighborhood: 'Vila Madalena', address: 'Rua Cardeal Arcoverde, 1574', capacity: 200, mainClusters: ['brasil_raiz'], priceRange: 'low' },
];

export const INITIAL_EXTERNAL_EVENTS: ExternalEvent[] = [
  {
    id: 'e1', competitorId: 'c1', title: 'Forró dos Ratos', date: '2024-10-25',
    cluster: 'brasil_raiz', lineupNames: ['DJ Cleiton Rasta', 'Trio Virgulino'], ticketPrice: 40,
    tickets: [{ id: 't1', name: 'Porta', price: 40, status: 'active', totalCount: 200 }]
  },
  {
    id: 'e2', competitorId: 'c2', title: 'Karaokê Box + DJ Set', date: '2024-10-26',
    cluster: 'open_format', lineupNames: ['DJ Residente'], ticketPrice: 80,
    tickets: [{ id: 't2', name: 'Antecipado', price: 60, status: 'sold_out', totalCount: 50 }, { id: 't3', name: 'Porta', price: 80, status: 'active', totalCount: 150 }]
  },
  {
    id: 'e3', competitorId: 'c3', title: 'Baile Funk 150BPM', date: '2024-10-26',
    cluster: 'urbano_hype', lineupNames: ['MC Pipokinha Cover', 'DJ Zé'], ticketPrice: 25,
    tickets: [{ id: 't4', name: 'Lote Único', price: 25, status: 'active', totalCount: 300 }]
  },
];

export const INITIAL_SCHEDULE: DaySchedule[] = [
  {
    day: "Segunda", theme: "Roda de Cura",
    events: [
      {
        id: '1', title: "Samba da Firma", description: "Happy Hour pós-trabalho",
        startTime: "18:00", endTime: "23:00", space: "green_area", cluster: "brasil_raiz", genre: "Pagode 90",
        lineup: ['2', '1'],
        tickets: [
          { id: 't1', name: 'Entrada Grátis (até 19h)', price: 0, status: 'active' },
          { id: 't2', name: 'Porta', price: 20, status: 'scheduled' }
        ]
      }
    ]
  },
  {
    day: "Terça", theme: "Noche Caliente",
    events: [
      { id: '2', title: "Aulas de Salsa", description: "Grátis para iniciantes", startTime: "19:00", endTime: "20:00", space: "green_area", cluster: "latinidades", genre: "Salsa", lineup: [] },
      {
        id: '3', title: "Baile Reggaeton", description: "Pista aberta",
        startTime: "20:00", endTime: "01:00", space: "green_area", cluster: "latinidades", genre: "Reggaeton",
        lineup: ['4'],
        tickets: [
          { id: 't3', name: 'Antecipado', price: 15, status: 'active', soldCount: 45, totalCount: 100 },
          { id: 't4', name: 'Porta', price: 30, status: 'scheduled' }
        ]
      }
    ]
  },
  {
    day: "Quarta", theme: "Brasil Profundo",
    events: [
      { id: '4', title: "Futebol & Forró", description: "Transmissão e Pé de Serra", startTime: "19:00", endTime: "00:00", space: "green_area", cluster: "brasil_raiz", genre: "Forró", lineup: ['1'] }
    ]
  },
  {
    day: "Quinta", theme: "Urban Flow",
    events: [
      { id: '5', title: "Hip Hop Lounge", description: "Aquecimento fds", startTime: "20:00", endTime: "02:00", space: "green_area", cluster: "urbano_hype", genre: "Hip Hop/R&B" }
    ]
  },
  {
    day: "Sexta", theme: "O Caos Organizado",
    events: [
      {
        id: '6', title: "Open Format Hits", description: "Pop -> Sertanejo -> Funk",
        startTime: "22:00", endTime: "05:00", space: "main_hall", cluster: "open_format", genre: "Open Format",
        lineup: ['6', '3', '4'],
        tickets: [
          { id: 't5', name: 'Lote Promo', price: 40, status: 'sold_out', soldCount: 100, totalCount: 100 },
          { id: 't6', name: '1º Lote', price: 60, status: 'active', soldCount: 150, totalCount: 300 },
          { id: 't7', name: '2º Lote', price: 80, status: 'scheduled' }
        ]
      }
    ]
  },
  {
    day: "Sábado", theme: "A Maratona",
    events: [
      { id: '7', title: "Feijoada & Samba", description: "Almoço familiar", startTime: "12:00", endTime: "16:00", space: "green_area", cluster: "brasil_raiz", genre: "Samba Raiz", lineup: ['2'] },
      { id: '8', title: "Sunset Transition", description: "Brasilidades dançantes", startTime: "16:00", endTime: "21:00", space: "green_area", cluster: "eclectic", genre: "Brasilidades", lineup: ['5'] },
      {
        id: '9', title: "Baile Hype", description: "Trap & Funk",
        startTime: "23:00", endTime: "05:00", space: "main_hall", cluster: "urbano_hype", genre: "Trap/Funk",
        lineup: ['3'],
        tickets: [{ id: 't8', name: 'Lote Único', price: 50, status: 'active' }]
      }
    ]
  },
  {
    day: "Domingo", theme: "Domingueira Solar",
    events: [
      { id: '10', title: "Forró ou Reggae", description: "Vibe solar", startTime: "14:00", endTime: "22:00", space: "green_area", cluster: "brasil_raiz", genre: "Reggae/Forró", lineup: ['1'] }
    ]
  }
];
