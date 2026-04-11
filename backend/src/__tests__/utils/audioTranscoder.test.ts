import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

const { mockFfmpegInstance, mockSetFfmpegPath, mockFfmpeg } = vi.hoisted(() => {
    const instance = {
        toFormat: vi.fn().mockReturnThis(),
        audioCodec: vi.fn().mockReturnThis(),
        on: vi.fn().mockReturnThis(),
        save: vi.fn(),
    };
    const setFfmpegPath = vi.fn();
    const ffmpeg = Object.assign(
        vi.fn(() => instance),
        { setFfmpegPath }
    );
    return {
        mockFfmpegInstance: instance,
        mockSetFfmpegPath: setFfmpegPath,
        mockFfmpeg: ffmpeg,
    };
});

vi.mock('fluent-ffmpeg', () => ({
    default: mockFfmpeg,
}));

vi.mock('fs', () => ({
    ...require('fs'),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
}));

import { AudioTranscoder } from '../../utils/audioTranscoder';

function getCallback(event: string): (...args: any[]) => void {
    const calls = mockFfmpegInstance.on.mock.calls;
    const call = calls.find(c => c[0] === event);
    if (!call) throw new Error(`No '${event}' callback registered`);
    return call[1];
}

describe('AudioTranscoder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('output-audio-data'));
    });

    it('successfully converts audio and returns base64', async () => {
        const inputData = Buffer.from('test-audio').toString('base64');
        const promise = AudioTranscoder.convertAudioToOgg(inputData);

        getCallback('end')();

        const result = await promise;
        expect(result).toBe(Buffer.from('output-audio-data').toString('base64'));
    });

    it('strips data URI prefix from base64', async () => {
        const rawBase64 = Buffer.from('test-audio').toString('base64');
        const dataUri = `data:audio/mpeg;base64,${rawBase64}`;
        const promise = AudioTranscoder.convertAudioToOgg(dataUri);

        getCallback('end')();

        await promise;

        const writtenBuffer = vi.mocked(fs.writeFileSync).mock.calls[0][1] as Buffer;
        expect(writtenBuffer.toString()).toBe('test-audio');
    });

    it('rejects on ffmpeg error', async () => {
        const inputData = Buffer.from('test').toString('base64');
        const promise = AudioTranscoder.convertAudioToOgg(inputData);

        const error = new Error('ffmpeg processing failed');
        getCallback('error')(error);

        await expect(promise).rejects.toThrow('ffmpeg processing failed');
    });

    it('cleans up temp files on success', async () => {
        const inputData = Buffer.from('test').toString('base64');
        const promise = AudioTranscoder.convertAudioToOgg(inputData);

        getCallback('end')();

        await promise;

        expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
    });

    it('cleans up temp files on error', async () => {
        const inputData = Buffer.from('test').toString('base64');
        const promise = AudioTranscoder.convertAudioToOgg(inputData);

        getCallback('error')(new Error('fail'));

        try { await promise; } catch {}

        expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
    });

    it('calls setFfmpegPath when ffmpeg executable exists', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        const inputData = Buffer.from('test').toString('base64');
        const promise = AudioTranscoder.convertAudioToOgg(inputData);

        getCallback('end')();

        await promise;

        expect(mockSetFfmpegPath).toHaveBeenCalledTimes(1);
        expect(mockSetFfmpegPath).toHaveBeenCalledWith(expect.any(String));
    });

    it('does not call setFfmpegPath when ffmpeg executable does not exist', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('output'));

        const inputData = Buffer.from('test').toString('base64');
        const promise = AudioTranscoder.convertAudioToOgg(inputData);

        getCallback('end')();

        await promise;

        expect(mockSetFfmpegPath).not.toHaveBeenCalled();
        expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it('rejects when readFileSync throws in end handler', async () => {
        vi.mocked(fs.readFileSync).mockImplementation(() => {
            throw new Error('read failed');
        });

        const inputData = Buffer.from('test').toString('base64');
        const promise = AudioTranscoder.convertAudioToOgg(inputData);

        getCallback('end')();

        await expect(promise).rejects.toThrow('read failed');
    });

    it('writes input buffer to temp file', async () => {
        const inputData = Buffer.from('audio-bytes').toString('base64');
        const promise = AudioTranscoder.convertAudioToOgg(inputData);

        getCallback('end')();

        await promise;

        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
        const [inputPath, writtenBuffer] = vi.mocked(fs.writeFileSync).mock.calls[0];
        expect(inputPath).toContain('temp_input_');
        expect((writtenBuffer as Buffer).toString()).toBe('audio-bytes');
    });

    it('calls ffmpeg with correct chain', async () => {
        const inputData = Buffer.from('test').toString('base64');
        const promise = AudioTranscoder.convertAudioToOgg(inputData);

        getCallback('end')();

        await promise;

        expect(mockFfmpegInstance.toFormat).toHaveBeenCalledWith('ogg');
        expect(mockFfmpegInstance.audioCodec).toHaveBeenCalledWith('libopus');
        expect(mockFfmpegInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
        expect(mockFfmpegInstance.on).toHaveBeenCalledWith('end', expect.any(Function));
        expect(mockFfmpegInstance.save).toHaveBeenCalledTimes(1);
        const outputPath = mockFfmpegInstance.save.mock.calls[0][0];
        expect(outputPath).toContain('temp_output_');
        expect(outputPath).toContain('.ogg');
    });
});
