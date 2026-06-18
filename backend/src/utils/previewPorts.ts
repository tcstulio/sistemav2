/**
 * Portas do preview de uma task do TaskRunner, derivadas do issueNumber.
 *
 * ÚNICA fonte da verdade — usada por `startPreview` (que SERVE o preview) e por `runVisualJudge`
 * (que CAPTURA o screenshot "depois"). Antes as fórmulas divergiam (o Judge montava a URL com
 * `3000 + (n % 1000)` enquanto o preview subia em `5174 + (n % 10)`), então o screenshot "depois"
 * batia numa porta sem servidor e o Judge Visual nunca avaliava o frontend (#374).
 */
export function previewPortsFor(issueNumber: number): { frontendPort: number; backendPort: number } {
    return {
        frontendPort: 5174 + (issueNumber % 10),
        backendPort: 3014 + (issueNumber % 10),
    };
}
