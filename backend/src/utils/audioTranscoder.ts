import * as path from 'path';
import * as fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import { createLogger } from './logger';
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

const log = createLogger('AudioTranscoder');

const ffmpegExecutablePath = ffmpegInstaller.path;

export const AudioTranscoder = {
    /**
     * Converts base64 audio data to OGG Opus format for WhatsApp Native PTT.
     * @param base64Data Raw base64 string (without data URI prefix if possible, or stripped inside)
     * @returns Promise resolving to base64 OGG Opus string
     */
    convertAudioToOgg: async (base64Data: string): Promise<string> => {
        return new Promise((resolve, reject) => {
            // Clean prefix if present
            const rawData = base64Data.replace(/^data:audio\/[a-z]+;base64,/, '');

            const inputPath = path.join(__dirname, `../../temp_input_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`);
            const outputPath = path.join(__dirname, `../../temp_output_${Date.now()}_${Math.random().toString(36).substring(7)}.ogg`);

            const buffer = Buffer.from(rawData, 'base64');
            fs.writeFileSync(inputPath, buffer);

            if (fs.existsSync(ffmpegExecutablePath)) {
                ffmpeg.setFfmpegPath(ffmpegExecutablePath);
            }

            ffmpeg(inputPath)
                .toFormat('ogg')
                .audioCodec('libopus')
                .on('error', (err: any) => {
                    log.error('FFmpeg Error', err);
                    cleanup(inputPath, outputPath);
                    reject(err);
                })
                .on('end', () => {
                    try {
                        const outputBuffer = fs.readFileSync(outputPath);
                        const outputBase64 = outputBuffer.toString('base64');
                        cleanup(inputPath, outputPath);
                        resolve(outputBase64);
                    } catch (e) {
                        reject(e);
                    }
                })
                .save(outputPath);
        });
    }
};

const cleanup = (input: string, output: string) => {
    if (fs.existsSync(input)) fs.unlinkSync(input);
    if (fs.existsSync(output)) fs.unlinkSync(output);
};
