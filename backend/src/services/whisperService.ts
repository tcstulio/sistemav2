// Transcrição de voz LOCAL via whisper.cpp — sem dependência de nuvem/saldo (#936).
// Binário + modelo ficam em backend/tools/whisper (gitignored; ver README de setup no .env.example).
// Pipeline: base64 (webm/ogg/mp3/wav do mic) → ffmpeg-static converte p/ wav 16k mono →
// whisper-cli transcreve (pt) → texto. Validado: frase com números transcrita 100% em ~6s (small).
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';

const log = logger.child('Whisper');
const execFileAsync = promisify(execFile);

const TOOLS_DIR = path.join(__dirname, '../../tools/whisper');
const DEFAULT_BIN = path.join(TOOLS_DIR, 'Release', 'whisper-cli.exe');
const DEFAULT_MODEL = path.join(TOOLS_DIR, 'ggml-small.bin');

function ffmpegPath(): string | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('ffmpeg-static') as string;
    } catch {
        return null;
    }
}

class WhisperService {
    private bin = process.env.WHISPER_BIN || DEFAULT_BIN;
    private model = process.env.WHISPER_MODEL || DEFAULT_MODEL;

    /** true quando binário, modelo e ffmpeg estão presentes — decide se o ASR local assume. */
    isAvailable(): boolean {
        return fs.existsSync(this.bin) && fs.existsSync(this.model) && !!ffmpegPath();
    }

    /**
     * Transcreve áudio (base64, qualquer formato que o ffmpeg leia) para texto em pt.
     * Lança em erro — o chamador decide o fallback (GLM-ASR na nuvem).
     */
    async transcribe(audioBase64: string, mimeType: string = 'audio/webm'): Promise<string> {
        if (!this.isAvailable()) throw new Error('Whisper local não instalado (binário/modelo/ffmpeg ausentes).');

        const ff = ffmpegPath()!;
        const tmp = os.tmpdir();
        const id = randomUUID();
        const ext = (mimeType.split('/')[1] || 'webm').split(';')[0];
        const inFile = path.join(tmp, `asr-${id}.${ext}`);
        const wavFile = path.join(tmp, `asr-${id}.wav`);

        try {
            const clean = audioBase64.replace(/^data:audio\/[^;]+;base64,/, '');
            fs.writeFileSync(inFile, Buffer.from(clean, 'base64'));

            // webm/opus/mp3/etc → wav 16kHz mono (formato do whisper.cpp)
            await execFileAsync(ff, ['-y', '-i', inFile, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavFile], { timeout: 60000 });

            const { stdout } = await execFileAsync(this.bin, [
                '-m', this.model,
                '-f', wavFile,
                '-l', 'pt',
                '--no-timestamps',
            ], { timeout: 180000, maxBuffer: 4 * 1024 * 1024 });

            const text = String(stdout || '').trim();
            if (!text) throw new Error('Whisper não retornou texto.');
            log.info(`Transcrição local ok (${text.length} chars)`);
            return text;
        } finally {
            for (const f of [inFile, wavFile]) {
                try { fs.unlinkSync(f); } catch { /* noop */ }
            }
        }
    }
}

export const whisperService = new WhisperService();
