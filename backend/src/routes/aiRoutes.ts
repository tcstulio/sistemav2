import { Router } from 'express';
import { aiService } from '../services/aiService';
import { requireDolibarrLogin } from '../middleware/authMiddleware';

const router = Router();

// Protect AI Routes
router.use(requireDolibarrLogin);

import { z } from 'zod';

// Schema
const GenerateReplySchema = z.object({
    history: z.array(z.object({
        role: z.enum(['user', 'model', 'system']),
        parts: z.string()
    })).optional(),
    context: z.string().optional()
});

const AnalyzeSystemSchema = z.object({
    query: z.string()
});

router.post('/generate-reply', async (req, res) => {
    try {
        const { history, context } = GenerateReplySchema.parse(req.body);
        // Map History structure if needed, or pass directly
        // Assuming aiService accepts the structure or we map it:
        // Service expects: { role: string; parts: string }[] ?
        // Or simplified string[]? Checking service usage... 
        // Based on previous file, it passes history || [].

        const reply = await aiService.generateReply(history as any || [], context || '');
        res.json({ reply });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});

router.post('/analyze-system', async (req, res) => {
    try {
        const { query } = AnalyzeSystemSchema.parse(req.body);
        const result = await aiService.analyzeSystem(query);
        res.json({ result });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});

const AnalyzeSentimentSchema = z.object({
    text: z.string()
});

router.post('/analyze-sentiment', async (req, res) => {
    try {
        const { text } = AnalyzeSentimentSchema.parse(req.body);
        const result = await aiService.analyzeSentiment(text);
        res.json(result);
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});

const ExtractCustomerSchema = z.object({
    text: z.string()
});

router.post('/extract/customer', async (req, res) => {
    try {
        const { text } = ExtractCustomerSchema.parse(req.body);
        const result = await aiService.extractCustomerInfo(text);
        res.json({ result });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});



const ExtractReceiptSchema = z.object({
    image: z.string()
});

router.post('/extract/receipt', async (req, res) => {
    try {
        const { image } = ExtractReceiptSchema.parse(req.body);
        const result = await aiService.extractReceiptData(image);
        res.json({ result });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});


const AnalyzeFinancialSchema = z.object({
    data: z.any()
});

router.post('/analyze/financial', async (req, res) => {
    try {
        const { data } = AnalyzeFinancialSchema.parse(req.body);
        const result = await aiService.analyzeFinancialHealth(data);
        res.json({ result });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});

const FixApiCallSchema = z.object({
    log: z.any()
});

router.post('/fix/api-call', async (req, res) => {
    try {
        const { log } = FixApiCallSchema.parse(req.body);
        const result = await aiService.fixApiCall(log);
        res.json({ result });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});

const GenerateCodeSchema = z.object({
    endpoint: z.string(),
    method: z.string(),
    description: z.string().optional()
});

router.post('/generate/code', async (req, res) => {
    try {
        const { endpoint, method, description } = GenerateCodeSchema.parse(req.body);
        const result = await aiService.generateCode(endpoint, method, description);
        res.json({ result });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        res.status(500).json({ error: error.message });
    }
});

export default router;
