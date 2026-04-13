import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectModal } from '../../components/whatsapp/ConnectModal';

describe('ConnectModal', () => {
    it('renders when isOpen is true', () => {
        render(
            <ConnectModal
                isOpen={true}
                onClose={() => {}}
                qrCodeUrl={null}
                isLoading={true}
                onRefresh={() => {}}
            />
        );
        expect(document.body.textContent).toBeTruthy();
    });

    it('does not render when isOpen is false', () => {
        render(
            <ConnectModal
                isOpen={false}
                onClose={() => {}}
                qrCodeUrl={null}
                isLoading={false}
                onRefresh={() => {}}
            />
        );
        expect(screen.queryByText('Conectar Aparelho')).toBeNull();
    });

    it('renders title', () => {
        render(
            <ConnectModal
                isOpen={true}
                onClose={() => {}}
                qrCodeUrl={null}
                isLoading={true}
                onRefresh={() => {}}
            />
        );
        expect(screen.getByText('Conectar Aparelho')).toBeTruthy();
    });

    it('renders instructions', () => {
        render(
            <ConnectModal
                isOpen={true}
                onClose={() => {}}
                qrCodeUrl={null}
                isLoading={true}
                onRefresh={() => {}}
            />
        );
        expect(screen.getByText(/Abra o WhatsApp/)).toBeTruthy();
    });

    it('renders loading state when qrCodeUrl is null', () => {
        render(
            <ConnectModal
                isOpen={true}
                onClose={() => {}}
                qrCodeUrl={null}
                isLoading={true}
                onRefresh={() => {}}
            />
        );
        expect(screen.getByText('Carregando QR Code...')).toBeTruthy();
    });

    it('renders QR code when qrCodeUrl is provided', () => {
        render(
            <ConnectModal
                isOpen={true}
                onClose={() => {}}
                qrCodeUrl="data:image/png;base64,abc123"
                isLoading={false}
                onRefresh={() => {}}
            />
        );
        expect(screen.getByAltText('QR Code')).toBeTruthy();
    });

    it('renders refresh button', () => {
        render(
            <ConnectModal
                isOpen={true}
                onClose={() => {}}
                qrCodeUrl={null}
                isLoading={false}
                onRefresh={() => {}}
            />
        );
        expect(screen.getByText(/Já escaneei/)).toBeTruthy();
    });

    it('calls onRefresh when refresh button is clicked', () => {
        let refreshClicked = false;
        render(
            <ConnectModal
                isOpen={true}
                onClose={() => {}}
                qrCodeUrl={null}
                isLoading={false}
                onRefresh={() => { refreshClicked = true; }}
            />
        );
        screen.getByText(/Já escaneei/).click();
        expect(refreshClicked).toBe(true);
    });

    it('calls onClose when close button is clicked', () => {
        let closeClicked = false;
        render(
            <ConnectModal
                isOpen={true}
                onClose={() => { closeClicked = true; }}
                qrCodeUrl={null}
                isLoading={false}
                onRefresh={() => {}}
            />
        );
        const closeButton = document.querySelector('.absolute.top-4.right-4');
        closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(closeClicked).toBe(true);
    });
});
