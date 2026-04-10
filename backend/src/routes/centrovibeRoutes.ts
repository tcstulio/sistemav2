import { Router } from 'express';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { centrovibeStoreService } from '../services/centrovibeStoreService';
import { eventScraperService } from '../services/eventScraperService';
import { aiService } from '../services/aiService';
import { logger } from '../utils/logger';

const log = logger.child('CentroVibeRoutes');
const router = Router();

router.use(requireDolibarrLogin);

const CENTROVIBE_SYSTEM_PROMPT = `
You are the "CentroVibe Advisor", an expert event planner, marketing manager, and cultural curator for a large venue in Downtown São Paulo (Centro).

**YOUR CAPABILITIES:**
1. **Event Planning:** Suggest themes, names, and lineups based on days of the week and clusters.
2. **Marketing & Social Media:** Write catchy Instagram captions (with emojis) tailored to specific target audiences.
3. **Operations (F&B):** Suggest food and drink menus that match the music vibe.
4. **Pricing Strategy:** Suggest ticket pricing strategies to maximize occupancy and revenue.

**VENUE CONTEXT:**
- **Green Area:** 250 pax, open-air, chill/bar vibe. Good for happy hours, samba, sunset.
- **Main Hall:** 650 pax, closed, club/show vibe. Good for late-night parties, trap, funk, big shows.
- **Location:** Centro Histórico SP. Diverse crowd (office workers, students, immigrants, tourists).

**CLUSTERS:**
- **Brasil Raiz:** Samba, Pagode, MPB.
- **Urbano & Hype:** Funk, Trap, Hip Hop.
- **Latinidades:** Reggaeton, Salsa.
- **Povão:** Sertanejo, Piseiro.
- **Open Format:** Mistura de hits.
- **Eclético:** Jazz, Instrumental, Chill.

**TONE:** Professional but cool, culturally aware of São Paulo slang and trends. Practical and results-oriented.
Always respond in Portuguese (Brazil).
`;

// ===========================================
// Full Data
// ===========================================

router.get('/data', (req, res) => {
    try {
        const data = centrovibeStoreService.getData();
        res.json(data);
    } catch (error: any) {
        log.error('Get data error', error);
        res.status(500).json({ error: error.message });
    }
});

router.put('/data', (req, res) => {
    try {
        centrovibeStoreService.saveData(req.body);
        res.json({ success: true });
    } catch (error: any) {
        log.error('Save data error', error);
        res.status(500).json({ error: error.message });
    }
});

// ===========================================
// Schedule
// ===========================================

router.get('/schedule', (req, res) => {
    try {
        res.json(centrovibeStoreService.getSchedule());
    } catch (error: any) {
        log.error('Get schedule error', error);
        res.status(500).json({ error: error.message });
    }
});

router.put('/schedule', (req, res) => {
    try {
        centrovibeStoreService.saveSchedule(req.body.schedule || req.body);
        res.json({ success: true });
    } catch (error: any) {
        log.error('Save schedule error', error);
        res.status(500).json({ error: error.message });
    }
});

// ===========================================
// Artists CRUD
// ===========================================

router.get('/artists', (req, res) => {
    try {
        res.json(centrovibeStoreService.getArtists());
    } catch (error: any) {
        log.error('Get artists error', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/artists', (req, res) => {
    try {
        const artist = centrovibeStoreService.addArtist(req.body);
        res.status(201).json(artist);
    } catch (error: any) {
        log.error('Add artist error', error);
        res.status(500).json({ error: error.message });
    }
});

router.put('/artists/:id', (req, res) => {
    try {
        const result = centrovibeStoreService.updateArtist(req.params.id, req.body);
        if (!result) return res.status(404).json({ error: 'Artist not found' });
        res.json(result);
    } catch (error: any) {
        log.error('Update artist error', error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/artists/:id', (req, res) => {
    try {
        const deleted = centrovibeStoreService.deleteArtist(req.params.id);
        if (!deleted) return res.status(404).json({ error: 'Artist not found' });
        res.json({ success: true });
    } catch (error: any) {
        log.error('Delete artist error', error);
        res.status(500).json({ error: error.message });
    }
});

// ===========================================
// Competitors CRUD
// ===========================================

router.get('/competitors', (req, res) => {
    try {
        res.json(centrovibeStoreService.getCompetitors());
    } catch (error: any) {
        log.error('Get competitors error', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/competitors', (req, res) => {
    try {
        const comp = centrovibeStoreService.addCompetitor(req.body);
        res.status(201).json(comp);
    } catch (error: any) {
        log.error('Add competitor error', error);
        res.status(500).json({ error: error.message });
    }
});

router.put('/competitors/:id', (req, res) => {
    try {
        const result = centrovibeStoreService.updateCompetitor(req.params.id, req.body);
        if (!result) return res.status(404).json({ error: 'Competitor not found' });
        res.json(result);
    } catch (error: any) {
        log.error('Update competitor error', error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/competitors/:id', (req, res) => {
    try {
        const deleted = centrovibeStoreService.deleteCompetitor(req.params.id);
        if (!deleted) return res.status(404).json({ error: 'Competitor not found' });
        res.json({ success: true });
    } catch (error: any) {
        log.error('Delete competitor error', error);
        res.status(500).json({ error: error.message });
    }
});

// ===========================================
// External Events CRUD
// ===========================================

router.get('/external-events', (req, res) => {
    try {
        res.json(centrovibeStoreService.getExternalEvents());
    } catch (error: any) {
        log.error('Get external events error', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/external-events', (req, res) => {
    try {
        const evt = centrovibeStoreService.addExternalEvent(req.body);
        res.status(201).json(evt);
    } catch (error: any) {
        log.error('Add external event error', error);
        res.status(500).json({ error: error.message });
    }
});

router.put('/external-events/:id', (req, res) => {
    try {
        const result = centrovibeStoreService.updateExternalEvent(req.params.id, req.body);
        if (!result) return res.status(404).json({ error: 'External event not found' });
        res.json(result);
    } catch (error: any) {
        log.error('Update external event error', error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/external-events/:id', (req, res) => {
    try {
        const deleted = centrovibeStoreService.deleteExternalEvent(req.params.id);
        if (!deleted) return res.status(404).json({ error: 'External event not found' });
        res.json({ success: true });
    } catch (error: any) {
        log.error('Delete external event error', error);
        res.status(500).json({ error: error.message });
    }
});

// ===========================================
// AI Endpoints
// ===========================================

router.post('/ai/vibe-check', async (req, res) => {
    try {
        const { genreA, genreB } = req.body;
        if (!genreA || !genreB) {
            return res.status(400).json({ error: 'genreA and genreB are required' });
        }

        const prompt = `Analyze the compatibility of these two music genres for a single event night in Downtown São Paulo: "${genreA}" and "${genreB}".

Return a JSON object with:
- isCompatible: boolean
- score: number (0-100)
- reasoning: short string explaining why (in Portuguese).
- suggestion: short string on how to make it work or warning to avoid (in Portuguese).

Return ONLY the JSON object, no other text.`;

        const history = [
            { role: 'system' as const, parts: CENTROVIBE_SYSTEM_PROMPT },
            { role: 'user' as const, parts: prompt }
        ];

        const reply = await aiService.generateReply(history, '', undefined, 'centrovibe');

        // Try to parse JSON from response
        try {
            const jsonMatch = reply.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                return res.json(result);
            }
        } catch {
            // If parsing fails, return structured error
        }

        res.json({
            isCompatible: false,
            score: 0,
            reasoning: reply || 'Não foi possível analisar.',
            suggestion: 'Tente novamente.'
        });
    } catch (error: any) {
        log.error('Vibe check error', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/ai/advisor', async (req, res) => {
    try {
        const { message, history: clientHistory } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'message is required' });
        }

        const history = [
            { role: 'system' as const, parts: CENTROVIBE_SYSTEM_PROMPT },
            ...(clientHistory || []).map((msg: any) => ({
                role: msg.role === 'model' ? 'model' as const : 'user' as const,
                parts: msg.text || msg.parts || ''
            })),
            { role: 'user' as const, parts: message }
        ];

        const reply = await aiService.generateReply(history, '', undefined, 'centrovibe');
        res.json({ reply });
    } catch (error: any) {
        log.error('Advisor chat error', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/ai/suggest', async (req, res) => {
    try {
        const { day, time } = req.body;
        if (!day || !time) {
            return res.status(400).json({ error: 'day and time are required' });
        }

        const prompt = `Suggest a creative event for ${day} at ${time} for a venue in Downtown São Paulo. Consider the cultural context.
Return a JSON object with: { title, genre, description, cluster }
Where cluster is one of: brasil_raiz, urbano_hype, latinidades, povao_coracao, open_format, eclectic.
Return ONLY the JSON, no other text.`;

        const history = [
            { role: 'system' as const, parts: CENTROVIBE_SYSTEM_PROMPT },
            { role: 'user' as const, parts: prompt }
        ];

        const reply = await aiService.generateReply(history, '', undefined, 'centrovibe');

        try {
            const jsonMatch = reply.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return res.json(JSON.parse(jsonMatch[0]));
            }
        } catch {
            // Parse failed
        }

        res.json({ title: '', genre: '', description: reply, cluster: 'eclectic' });
    } catch (error: any) {
        log.error('Suggest error', error);
        res.status(500).json({ error: error.message });
    }
});

// ===========================================
// Scraper Endpoints
// ===========================================

router.post('/scraper/run', async (req, res) => {
    try {
        const status = eventScraperService.getStatus();
        if (status.isRunning) {
            return res.status(409).json({ error: 'Scrape already in progress', status });
        }

        // Run async - return immediately with 202
        res.status(202).json({ message: 'Scrape started', status: { ...status, isRunning: true } });

        // Execute in background
        eventScraperService.runScrape().catch(err => {
            log.error('Background scrape error', err);
        });
    } catch (error: any) {
        log.error('Scraper run error', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/scraper/status', (req, res) => {
    try {
        res.json(eventScraperService.getStatus());
    } catch (error: any) {
        log.error('Scraper status error', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
