import axios from 'axios';
import { safeStorage } from '../utils/safeStorage';
import type {
    CentroVibeData, Artist, DaySchedule, Competitor, ExternalEvent, CompatibilityResult, ScraperStatus
} from '../types/centrovibe';

const API_URL = '/api/centrovibe';

const getAuthHeaders = () => {
    const savedConfigObj = safeStorage.getJSON<Record<string, any>>('coolgroove_config', {});
    const token = savedConfigObj.apiKey || '';
    return {
        headers: {
            'Authorization': 'Bearer ' + token
        }
    };
};

export const CentroVibeService = {

    // --- Full Data ---

    fetchData: async (): Promise<CentroVibeData> => {
        const { data } = await axios.get(`${API_URL}/data`, getAuthHeaders());
        return data;
    },

    saveData: async (storeData: CentroVibeData): Promise<void> => {
        await axios.put(`${API_URL}/data`, storeData, getAuthHeaders());
    },

    // --- Schedule ---

    fetchSchedule: async (): Promise<DaySchedule[]> => {
        const { data } = await axios.get(`${API_URL}/schedule`, getAuthHeaders());
        return data;
    },

    saveSchedule: async (schedule: DaySchedule[]): Promise<void> => {
        await axios.put(`${API_URL}/schedule`, { schedule }, getAuthHeaders());
    },

    // --- Artists ---

    fetchArtists: async (): Promise<Artist[]> => {
        const { data } = await axios.get(`${API_URL}/artists`, getAuthHeaders());
        return data;
    },

    addArtist: async (artist: Artist): Promise<Artist> => {
        const { data } = await axios.post(`${API_URL}/artists`, artist, getAuthHeaders());
        return data;
    },

    updateArtist: async (id: string, updates: Partial<Artist>): Promise<Artist> => {
        const { data } = await axios.put(`${API_URL}/artists/${id}`, updates, getAuthHeaders());
        return data;
    },

    deleteArtist: async (id: string): Promise<void> => {
        await axios.delete(`${API_URL}/artists/${id}`, getAuthHeaders());
    },

    // --- Competitors ---

    fetchCompetitors: async (): Promise<Competitor[]> => {
        const { data } = await axios.get(`${API_URL}/competitors`, getAuthHeaders());
        return data;
    },

    addCompetitor: async (competitor: Competitor): Promise<Competitor> => {
        const { data } = await axios.post(`${API_URL}/competitors`, competitor, getAuthHeaders());
        return data;
    },

    updateCompetitor: async (id: string, updates: Partial<Competitor>): Promise<Competitor> => {
        const { data } = await axios.put(`${API_URL}/competitors/${id}`, updates, getAuthHeaders());
        return data;
    },

    deleteCompetitor: async (id: string): Promise<void> => {
        await axios.delete(`${API_URL}/competitors/${id}`, getAuthHeaders());
    },

    // --- External Events ---

    fetchExternalEvents: async (): Promise<ExternalEvent[]> => {
        const { data } = await axios.get(`${API_URL}/external-events`, getAuthHeaders());
        return data;
    },

    addExternalEvent: async (event: ExternalEvent): Promise<ExternalEvent> => {
        const { data } = await axios.post(`${API_URL}/external-events`, event, getAuthHeaders());
        return data;
    },

    updateExternalEvent: async (id: string, updates: Partial<ExternalEvent>): Promise<ExternalEvent> => {
        const { data } = await axios.put(`${API_URL}/external-events/${id}`, updates, getAuthHeaders());
        return data;
    },

    deleteExternalEvent: async (id: string): Promise<void> => {
        await axios.delete(`${API_URL}/external-events/${id}`, getAuthHeaders());
    },

    // --- AI ---

    checkVibeCompatibility: async (genreA: string, genreB: string): Promise<CompatibilityResult> => {
        const { data } = await axios.post(`${API_URL}/ai/vibe-check`, { genreA, genreB }, getAuthHeaders());
        return data;
    },

    chatWithAdvisor: async (message: string, history: { role: string; text: string }[] = []): Promise<string> => {
        const { data } = await axios.post(`${API_URL}/ai/advisor`, { message, history }, getAuthHeaders());
        return data.reply;
    },

    suggestAgendaItem: async (day: string, time: string): Promise<{ title: string; genre: string; description: string; cluster: string } | null> => {
        try {
            const { data } = await axios.post(`${API_URL}/ai/suggest`, { day, time }, getAuthHeaders());
            return data;
        } catch {
            return null;
        }
    },

    // --- Scraper ---

    triggerScrape: async (): Promise<ScraperStatus> => {
        const { data } = await axios.post(`${API_URL}/scraper/run`, {}, getAuthHeaders());
        return data.status;
    },

    getScraperStatus: async (): Promise<ScraperStatus> => {
        const { data } = await axios.get(`${API_URL}/scraper/status`, getAuthHeaders());
        return data;
    }
};
