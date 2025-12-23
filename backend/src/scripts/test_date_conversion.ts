
// Logic copied directly from src/hooks/dolibarr/mappers.ts (UPDATED)

const toTimestamp = (value: any): number => {
    if (!value) return 0;

    // Handle numeric strings (e.g. "1700000000" from PHP/MySQL drivers)
    if (typeof value === 'string' && !isNaN(Number(value)) && /^\d+$/.test(value)) {
        value = Number(value);
    }

    if (typeof value === 'number') {
        if (value < 100000000000) {
            return value * 1000;
        }
        return value;
    }
    const date = new Date(value);
    return isNaN(date.getTime()) ? 0 : date.getTime();
};

const mapThirdParty_TestVersion = (raw: any) => ({
    id: String(raw.id),
    name: raw.name || '',
    date_modification: toTimestamp(raw.tms),
});

console.log("=== Verificando Conversão de Datas (Lógica Isolada - COM FIX) ===");

// 1. Simular resposta do Backend (Inteiros UNIX Timestamp COMO STRING)
// Ex: "1703512800" (PHP Stringified Integer)
const mockBackendResponse = {
    id: "1",
    name: "Cliente Teste",
    tms: "1703512800" // AGORA COMO STRING
};

// 2. Executar Lógica
const result = mapThirdParty_TestVersion(mockBackendResponse);

console.log("Raw TMS (Backend String):", mockBackendResponse.tms);
console.log("Mapped TMS (Frontend Number):", result.date_modification);

// 3. Validação
const expectedMs = Number(mockBackendResponse.tms) * 1000;

if (result.date_modification === expectedMs) {
    console.log("✅ SUCESSO: A string numérica foi detectada e convertida corretamente.");
    console.log(`   Data Final: ${new Date(result.date_modification).toISOString()}`);
} else {
    console.error("❌ FALHA: A conversão falhou para string numérica.");
    console.log(`   Esperado: ${expectedMs}`);
    console.log(`   Recebido: ${result.date_modification}`);
}
