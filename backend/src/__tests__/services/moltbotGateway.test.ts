import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'http';

vi.mock('http', () => ({
    default: {
        request: vi.fn(),
    },
}));

import { moltbotGateway, MoltbotGateway } from '../../services/moltbotGateway';
import httpModule from 'http';

describe('MoltbotGateway', () => {
    let gateway: MoltbotGateway;

    function mockSuccessfulRequest(responseData: any, contentType = 'application/json') {
        const mockReq = {
            on: vi.fn(),
            write: vi.fn(),
            end: vi.fn(),
            destroy: vi.fn(),
        };
        const mockRes = {
            on: vi.fn().mockImplementation((event: string, handler: any) => {
                if (event === 'data') handler(JSON.stringify(responseData));
                if (event === 'end') handler();
            }),
            headers: { 'content-type': contentType },
        };

        (httpModule.request as any).mockImplementation((opts: any, cb: any) => {
            cb(mockRes);
            return mockReq as any;
        });

        return mockReq;
    }

    function mockFailedRequest(errorMsg: string) {
        const mockReq = {
            on: vi.fn((event: string, handler: any) => {
                if (event === 'error') handler(new Error(errorMsg));
            }),
            write: vi.fn(),
            end: vi.fn(),
            destroy: vi.fn(),
        };

        (httpModule.request as any).mockReturnValue(mockReq as any);
        return mockReq;
    }

    function mockTimeout() {
        const mockReq = {
            on: vi.fn((event: string, handler: any) => {
                if (event === 'timeout') handler();
            }),
            write: vi.fn(),
            end: vi.fn(),
            destroy: vi.fn(),
        };

        (httpModule.request as any).mockReturnValue(mockReq as any);
        return mockReq;
    }

    beforeEach(() => {
        vi.clearAllMocks();
        gateway = new MoltbotGateway({ host: 'localhost', port: 18789, token: 'test-token', timeout: 5000 });
    });

    describe('isEnabled', () => {
        it('returns true when env is set', () => {
            process.env.MOLTBOT_ENABLED = 'true';
            expect(gateway.isEnabled()).toBe(true);
            delete process.env.MOLTBOT_ENABLED;
        });

        it('returns false when env is not set', () => {
            delete process.env.MOLTBOT_ENABLED;
            expect(gateway.isEnabled()).toBe(false);
        });
    });

    describe('getStatus', () => {
        it('returns healthy status', async () => {
            mockSuccessfulRequest({ uptime: 1234, channels: { whatsapp: { status: 'ready' } } });
            const status = await gateway.getStatus();
            expect(status.healthy).toBe(true);
            expect(status.uptime).toBe(1234);
        });

        it('returns unhealthy on error', async () => {
            mockFailedRequest('Connection refused');
            const status = await gateway.getStatus();
            expect(status.healthy).toBe(false);
            expect(status.channels?.whatsapp?.connected).toBe(false);
        });
    });

    describe('getWhatsAppStatus', () => {
        it('returns connected when ready', async () => {
            mockSuccessfulRequest({
                uptime: 100,
                channels: { whatsapp: { status: 'ready', connected: true, phone: '+5511999999999' } },
            });

            const status = await gateway.getWhatsAppStatus();
            expect(status.connected).toBe(true);
            expect(status.status).toBe('ready');
            expect(status.phone).toBe('+5511999999999');
        });

        it('returns unknown when no whatsapp channel', async () => {
            mockSuccessfulRequest({ uptime: 0, channels: {} });
            const status = await gateway.getWhatsAppStatus();
            expect(status.connected).toBe(false);
            expect(status.status).toBe('unknown');
        });

        it('handles error', async () => {
            mockFailedRequest('Connection failed');
            const status = await gateway.getWhatsAppStatus();
            expect(status.connected).toBe(false);
            expect(status.error).toContain('Connection failed');
        });
    });

    describe('sendMessage', () => {
        it('sends message successfully', async () => {
            mockSuccessfulRequest({ id: 'msg-1', timestamp: Date.now() });
            const result = await gateway.sendMessage({ chatId: '5511@c.us', text: 'Hello' });
            expect(result.success).toBe(true);
            expect(result.messageId).toBe('msg-1');
        });

        it('handles send error', async () => {
            mockFailedRequest('Send failed');
            const result = await gateway.sendMessage({ chatId: '5511@c.us', text: 'Hello' });
            expect(result.success).toBe(false);
            expect(result.error).toContain('Send failed');
        });
    });

    describe('sendFile', () => {
        it('sends file successfully', async () => {
            mockSuccessfulRequest({ id: 'file-1', timestamp: Date.now() });
            const result = await gateway.sendFile({
                chatId: '5511@c.us',
                file: Buffer.from('file-data'),
                filename: 'test.pdf',
                caption: 'Test file',
            });
            expect(result.success).toBe(true);
        });

        it('handles file send error', async () => {
            mockFailedRequest('File error');
            const result = await gateway.sendFile({ chatId: '5511@c.us', file: Buffer.from(''), filename: 'x' });
            expect(result.success).toBe(false);
        });
    });

    describe('sendVoice', () => {
        it('sends voice successfully', async () => {
            mockSuccessfulRequest({ id: 'voice-1', timestamp: Date.now() });
            const result = await gateway.sendVoice('5511@c.us', 'base64audio', 'session1');
            expect(result.success).toBe(true);
        });

        it('handles voice error', async () => {
            mockFailedRequest('Voice error');
            const result = await gateway.sendVoice('5511@c.us', 'audio');
            expect(result.success).toBe(false);
        });
    });

    describe('getChats', () => {
        it('returns chats', async () => {
            mockSuccessfulRequest({ chats: [{ id: 'c1', name: 'Chat1' }] });
            const result = await gateway.getChats('session1');
            expect(result).toHaveLength(1);
        });

        it('returns empty on error', async () => {
            mockFailedRequest('error');
            const result = await gateway.getChats();
            expect(result).toEqual([]);
        });
    });

    describe('getMessages', () => {
        it('returns messages', async () => {
            mockSuccessfulRequest({ messages: [{ id: 'm1', body: 'Hi' }] });
            const result = await gateway.getMessages('5511@c.us', 10);
            expect(result).toHaveLength(1);
        });

        it('returns empty on error', async () => {
            mockFailedRequest('error');
            const result = await gateway.getMessages('5511@c.us');
            expect(result).toEqual([]);
        });
    });

    describe('startSession', () => {
        it('starts session', async () => {
            mockSuccessfulRequest({ status: 'started' });
            const result = await gateway.startSession('sess1');
            expect(result.status).toBe('started');
        });

        it('returns error on failure', async () => {
            mockFailedRequest('fail');
            const result = await gateway.startSession('sess1');
            expect(result.status).toBe('error');
        });
    });

    describe('stopSession', () => {
        it('stops session', async () => {
            mockSuccessfulRequest({ status: 'stopped' });
            const result = await gateway.stopSession('sess1');
            expect(result.status).toBe('stopped');
        });

        it('returns error on failure', async () => {
            mockFailedRequest('fail');
            const result = await gateway.stopSession('sess1');
            expect(result.status).toBe('error');
        });
    });

    describe('getQRCode', () => {
        it('returns QR code', async () => {
            mockSuccessfulRequest({ qr: 'qr-code-data' });
            const result = await gateway.getQRCode('sess1');
            expect(result).toBe('qr-code-data');
        });

        it('returns null on error', async () => {
            mockFailedRequest('fail');
            const result = await gateway.getQRCode('sess1');
            expect(result).toBeNull();
        });
    });

    describe('callAPI edge cases', () => {
        it('rejects on JSON parse failure', async () => {
            const mockReq = {
                on: vi.fn(),
                write: vi.fn(),
                end: vi.fn(),
            };
            const mockRes = {
                on: vi.fn(),
                headers: { 'content-type': 'application/json' },
            };
            let dataHandler: any;
            let endHandler: any;
            mockRes.on = vi.fn((event: string, handler: any) => {
                if (event === 'data') {
                    dataHandler = handler;
                } else if (event === 'end') {
                    endHandler = handler;
                }
            });

            (httpModule.request as any).mockImplementation((opts: any, cb: any) => {
                cb(mockRes);
                if (dataHandler) dataHandler('not-json');
                if (endHandler) endHandler();
                return mockReq as any;
            });

            await expect(gateway.getStatus()).resolves.toEqual(expect.objectContaining({ healthy: false }));
        });

        it('rejects on HTML response', async () => {
            const mockReq = { on: vi.fn(), write: vi.fn(), end: vi.fn() };
            let dataHandler: any;
            let endHandler: any;
            const mockRes = {
                on: vi.fn((event: string, handler: any) => {
                    if (event === 'data') dataHandler = handler;
                    if (event === 'end') endHandler = handler;
                }),
                headers: { 'content-type': 'text/html' },
            };

            (httpModule.request as any).mockImplementation((opts: any, cb: any) => {
                cb(mockRes);
                if (dataHandler) dataHandler('<html></html>');
                if (endHandler) endHandler();
                return mockReq as any;
            });

            await expect(gateway.getStatus()).resolves.toEqual(expect.objectContaining({ healthy: false }));
        });

        it('rejects on timeout', async () => {
            mockTimeout();
            await expect(gateway.getStatus()).resolves.toEqual(expect.objectContaining({ healthy: false }));
        });

        it('sends body for POST requests', async () => {
            const mockReq = mockSuccessfulRequest({ ok: true });
            await gateway.sendMessage({ chatId: 'test', text: 'hi' });
            expect(mockReq.write).toHaveBeenCalled();
            expect(mockReq.end).toHaveBeenCalled();
        });
    });
});
