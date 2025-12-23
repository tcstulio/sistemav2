export { }; // Treat as module

// Logic copied directly from src/hooks/dolibarr/mappers.ts (UPDATED with numeric string fix)
const toTimestamp = (value: any): number => {
    if (!value) return 0;
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

const toString = (value: any): string => {
    if (value === null || value === undefined) return '';
    return String(value);
};

const toNumber = (value: any): number => {
    const num = Number(value);
    return isNaN(num) ? 0 : num;
};

// Mapper sendo testado (Simulando a correção proposta)
const mapAgendaEvent_Test = (raw: any) => ({
    id: toString(raw.id),
    label: raw.label || '',
    // Backend SQL: UNIX_TIMESTAMP(datep) as date_start
    date_start: toTimestamp(raw.date_start || raw.datep),

    // Backend SQL: UNIX_TIMESTAMP(datep2) as date_end
    // Mapper Atual Vê: raw.datef (ERRADO)
    // Mapper Proposto Vê: raw.date_end (CORRETO)
    date_end: toTimestamp(raw.date_end || raw.datep2 || raw.datef),

    type_code: raw.type_code || raw.code || '',
});

console.log("=== Verificando Mapeamento de Eventos (Agenda) ===");

// 1. Simular Resposta REAL do custom_sync.php (Baseado no SQL lido)
/*
   SQL: SELECT ..., UNIX_TIMESTAMP(datep) as date_start, UNIX_TIMESTAMP(datep2) as date_end ...
*/
const mockEventsResponse = {
    id: "99",
    label: "Reunião de Alinhamento",
    date_start: 1703512800, // 25/12/23 14:00
    date_end: 1703516400,   // 25/12/23 15:00 - NOME DO CAMPO NO SQL É 'date_end'
    type_code: "AC_MEETING"
};

console.log("Dados Vindos do Backend (Simulado):", JSON.stringify(mockEventsResponse, null, 2));

// 2. Mapear
const mapped = mapAgendaEvent_Test(mockEventsResponse);

console.log("\nDados Mapeados (Frontend):");
console.log(`Inicio: ${new Date(mapped.date_start).toISOString()} (TS: ${mapped.date_start})`);
console.log(`Fim:    ${new Date(mapped.date_end).toISOString()}   (TS: ${mapped.date_end})`);

// 3. Verificação
if (mapped.date_end === 1703516400000) {
    console.log("✅ SUCESSO: O mapper leu corretamente o campo 'date_end'.");
} else {
    console.error("❌ FALHA: O mapper não encontrou a data de fim.");
}
