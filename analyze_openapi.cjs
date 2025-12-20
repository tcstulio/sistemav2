const fs = require('fs');
const path = require('path');

const openApiPath = path.join('c:', 'Projetos', 'Sistema', 'openapi_3.json');

try {
    if (!fs.existsSync(openApiPath)) {
        console.log("OpenAPI file not found at " + openApiPath);
        process.exit(1);
    }

    const spec = JSON.parse(fs.readFileSync(openApiPath, 'utf8'));
    const paths = spec.paths || {};

    console.log(`Analyzing ${Object.keys(paths).length} paths...`);

    const writeOperations = [];

    for (const [endpoint, methods] of Object.entries(paths)) {
        for (const [method, details] of Object.entries(methods)) {
            if (['post', 'put', 'delete'].includes(method.toLowerCase())) {
                writeOperations.push({
                    method: method.toUpperCase(),
                    endpoint: endpoint,
                    summary: details.summary || details.description || 'No description',
                    tags: details.tags || []
                });
            }
        }
    }

    // Filter for "Critical" modules usually present in ERPs
    const criticalTags = ['invoices', 'thirdparties', 'orders', 'proposals', 'supplierorders', 'products', 'stockmovements'];

    const criticalOps = writeOperations.filter(op => {
        return op.tags.some(tag => criticalTags.some(ct => tag.toLowerCase().includes(ct)));
    });

    console.log("\n--- All Write Operations Found: " + writeOperations.length + " ---");
    console.log("--- Critical Module Write Operations: " + criticalOps.length + " ---\n");

    // Output a few examples per module
    criticalTags.forEach(tag => {
        console.log(`\n[${tag.toUpperCase()}]`);
        const ops = criticalOps.filter(op => op.tags.some(t => t.toLowerCase().includes(tag))).slice(0, 5);
        ops.forEach(op => console.log(`  ${op.method} ${op.endpoint} - ${op.summary.slice(0, 50)}...`));
        if (ops.length === 0) console.log("  (None found or typical tag name mismatch)");
    });

} catch (e) {
    console.error("Error parsing OpenAPI:", e);
}
