import { useState } from 'react';

export function Toggle() {
    const [ligado, setLigado] = useState(false);

    return (
        <div>
            <span>{ligado ? 'Ligado' : 'Desligado'}</span>
            <button onClick={() => setLigado((prev) => !prev)}>
                {ligado ? 'Desligar' : 'Ligar'}
            </button>
        </div>
    );
}
