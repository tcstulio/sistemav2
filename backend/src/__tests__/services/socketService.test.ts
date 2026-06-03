import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('socket.io', () => {
    const MockServer = function() {
        return mockIoInstance;
    };
    MockServer.prototype = mockIoInstance;
    return { Server: MockServer };
});

vi.mock('http', () => ({
    Server: vi.fn(),
}));

vi.mock('../../services/dolibarrService', () => ({
    dolibarrService: { validateApiKey: vi.fn() },
}));

// auth do socket aceita proto-session; sem sessão (null) cai no fallback validateApiKey.
vi.mock('../../services/protoSession', () => ({
    getProtoSession: vi.fn(() => null),
}));

const mockOn = vi.fn();
const mockUse = vi.fn();
const mockEmit = vi.fn();
const mockIoInstance = {
    use: mockUse,
    on: mockOn,
    emit: mockEmit,
};

describe('socketService', () => {
    let socketService: typeof import('../../services/socketService').socketService;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        mockOn.mockReset();
        mockUse.mockReset();
        mockEmit.mockReset();
    });

    describe('init', () => {
        it('initializes Socket.io with CORS', async () => {
            socketService = (await import('../../services/socketService')).socketService;
            const mockHttpServer = {} as any;
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'development';

            socketService.init(mockHttpServer);

            expect(mockUse).toHaveBeenCalled();
            expect(mockOn).toHaveBeenCalledWith('connection', expect.any(Function));

            process.env.NODE_ENV = originalEnv;
        });

        it('auth middleware rejects without token', async () => {
            socketService = (await import('../../services/socketService')).socketService;
            socketService.init({} as any);

            const authMiddleware = mockUse.mock.calls[0][0];
            const mockSocket = {
                handshake: { auth: {}, headers: {} },
            };
            const mockNext = vi.fn();

            authMiddleware(mockSocket, mockNext);
            expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({
                message: expect.stringContaining('No API Key'),
            }));
        });

        it('auth middleware validates token', async () => {
            const { dolibarrService } = await import('../../services/dolibarrService');
            (dolibarrService.validateApiKey as any).mockResolvedValue(true);

            socketService = (await import('../../services/socketService')).socketService;
            socketService.init({} as any);

            const authMiddleware = mockUse.mock.calls[0][0];
            const mockSocket = {
                handshake: { auth: { token: 'valid-key' }, headers: {} },
            };
            const mockNext = vi.fn();

            await authMiddleware(mockSocket, mockNext);
            expect(mockNext).toHaveBeenCalled();
        });

        it('auth middleware rejects invalid token', async () => {
            const { dolibarrService } = await import('../../services/dolibarrService');
            (dolibarrService.validateApiKey as any).mockResolvedValue(false);

            socketService = (await import('../../services/socketService')).socketService;
            socketService.init({} as any);

            const authMiddleware = mockUse.mock.calls[0][0];
            const mockSocket = {
                handshake: { auth: { token: 'bad-key' }, headers: {} },
            };
            const mockNext = vi.fn();

            await authMiddleware(mockSocket, mockNext);
            expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({
                message: expect.stringContaining('Authentication'),
            }));
        });

        it('auth middleware handles dolibarrService error', async () => {
            const { dolibarrService } = await import('../../services/dolibarrService');
            (dolibarrService.validateApiKey as any).mockRejectedValue(new Error('DB error'));

            socketService = (await import('../../services/socketService')).socketService;
            socketService.init({} as any);

            const authMiddleware = mockUse.mock.calls[0][0];
            const mockSocket = {
                handshake: { auth: { token: 'key' }, headers: {} },
            };
            const mockNext = vi.fn();

            await authMiddleware(mockSocket, mockNext);
            expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({
                message: expect.stringContaining('Authentication failed'),
            }));
        });

        it('uses dolapikey from headers', async () => {
            const { dolibarrService } = await import('../../services/dolibarrService');
            (dolibarrService.validateApiKey as any).mockResolvedValue(true);

            socketService = (await import('../../services/socketService')).socketService;
            socketService.init({} as any);

            const authMiddleware = mockUse.mock.calls[0][0];
            const mockSocket = {
                handshake: { auth: {}, headers: { dolapikey: 'header-key' } },
            };
            const mockNext = vi.fn();

            await authMiddleware(mockSocket, mockNext);
            expect(mockNext).toHaveBeenCalled();
        });
    });

    describe('connection handler', () => {
        it('handles client connection and disconnect', async () => {
            socketService = (await import('../../services/socketService')).socketService;
            socketService.init({} as any);

            const connectionHandler = mockOn.mock.calls[0][1];
            const mockSocket = { id: 'socket-1', on: vi.fn() };

            connectionHandler(mockSocket);
            expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
        });
    });

    describe('getIO', () => {
        it('throws when not initialized', async () => {
            vi.resetModules();
            socketService = (await import('../../services/socketService')).socketService;
            expect(() => socketService.getIO()).toThrow('Socket.io not initialized');
        });

        it('returns IO instance when initialized', async () => {
            socketService = (await import('../../services/socketService')).socketService;
            socketService.init({} as any);
            expect(socketService.getIO()).toBe(mockIoInstance);
        });
    });

    describe('emit', () => {
        it('emits event when initialized', async () => {
            socketService = (await import('../../services/socketService')).socketService;
            socketService.init({} as any);
            socketService.emit('test-event', { data: 'test' });
            expect(mockEmit).toHaveBeenCalledWith('test-event', { data: 'test' });
        });

        it('does not throw when not initialized', async () => {
            vi.resetModules();
            socketService = (await import('../../services/socketService')).socketService;
            expect(() => socketService.emit('test-event', {})).not.toThrow();
        });
    });
});
