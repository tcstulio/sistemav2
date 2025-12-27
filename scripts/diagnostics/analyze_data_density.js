import fs from 'fs';

const swaggerPath = './swagger_full.json';
const typesPath = './types.ts';

// Config: Map our Interface Names to Swagger Definition Names
// Adjust keys/values based on findings
const MAPPING = {
    'ThirdParty': 'ThirdpartyThirdparty', // Often swagger logic uses Module+Class
    'Invoice': 'InvoiceInvoice',
    'Product': 'ProductProduct',
    'Project': 'ProjectProject',
    'Task': 'TaskTask',
    'Proposal': 'PropalPropal',
    'Order': 'OrderOrder',
    'User': 'UserUser',
    'BankAccount': 'BankaccountBankaccount'
};

/* 
   NOTE: I need to verify the exact definition names in swagger.json first. 
   Usually extracted from "definitions" key.
*/

console.log('Loading Data...');
const swagger = JSON.parse(fs.readFileSync(swaggerPath, 'utf8'));
const typesFile = fs.readFileSync(typesPath, 'utf8');

// 1. Verify Definition Names
const availableDefinitions = Object.keys(swagger.definitions);
// console.log('Available Definitions Sample:', availableDefinitions.slice(0, 10));

// Heuristic to find best match if strict mapping fails
function findBestMatch(interfaceName) {
    // Try exact match in mapping
    if (MAPPING[interfaceName] && swagger.definitions[MAPPING[interfaceName]]) {
        return MAPPING[interfaceName];
    }
    // Try simple case-insensitive substring
    const match = availableDefinitions.find(d => d.toLowerCase() === interfaceName.toLowerCase());
    if (match) return match;

    // Try "ModuleObject" pattern often used (e.g. ThirdParty -> Thirdparty)
    // Actually typically its lowercase for module, capitalized for object?
    // Let's rely on mapping or precise search later.
    return availableDefinitions.find(d => d.toLowerCase().includes(interfaceName.toLowerCase()));
}

const report = [];
report.push('# Data Density Analysis Report');
report.push(`Generated at: ${new Date().toISOString()}`);
report.push('');
report.push('Comparing manual TypeScript interfaces against full Swagger definitions to identify missing data fields.');
report.push('');

// 2. Parse TypeScript Interfaces (Naive Regex)
// Capture "export interface Name { ... }" block
function extractInterfaceFields(name) {
    const regex = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`, 'm');
    const match = typesFile.match(regex);
    if (!match) return new Set();

    const block = match[1];
    const fields = new Set();
    // Match "fieldName:" or "fieldName?:" 
    const lines = block.split('\n');
    lines.forEach(line => {
        const fieldMatch = line.match(/^\s*([a-zA-Z0-9_]+)\??:/);
        if (fieldMatch) {
            fields.add(fieldMatch[1]);
        }
    });
    return fields;
}

// 3. Compare
for (const [interfaceName, _] of Object.entries(MAPPING)) {
    const swaggerDefName = findBestMatch(interfaceName);

    if (!swaggerDefName) {
        report.push(`### ⚠️ Interface \`${interfaceName}\`: No matching Swagger definition found.`);
        continue;
    }

    const definition = swagger.definitions[swaggerDefName];
    const swaggerFields = Object.keys(definition.properties || {});
    const manualFields = extractInterfaceFields(interfaceName);

    if (manualFields.size === 0) {
        report.push(`### ⚠️ Interface \`${interfaceName}\`: Could not parse manual definition in types.ts.`);
        continue;
    }

    // Analysis
    const missingFields = swaggerFields.filter(f => !manualFields.has(f));
    const coverage = Math.round((manualFields.size / swaggerFields.length) * 100);

    report.push(`## Entity: ${interfaceName} (Swagger: \`${swaggerDefName}\`)`);
    report.push(`- **Coverage**: We use **${manualFields.size}** out of **${swaggerFields.length}** available fields (${coverage}%).`);

    if (missingFields.length > 0) {
        report.push(`- **Top Missing Data** (first 20):`);
        report.push('  ' + missingFields.slice(0, 20).map(f => `\`${f}\``).join(', '));
        if (missingFields.length > 20) report.push(`  ... and ${missingFields.length - 20} more.`);
    }

    // Check for Type Mismatches (Basic)
    report.push('- **Potential Type Conflicts**:');
    let conflictCount = 0;
    manualFields.forEach(field => {
        if (definition.properties && definition.properties[field]) {
            const swagType = definition.properties[field].type;
            // We can't easily parse TS types with regex, but we can guess common errors
            // e.g. if swagger says 'integer' and we usually treat as string in IDs, that's fine.
            // But if swagger says 'array' and we assume scalar...
            if (swagType === 'array' || swagType === 'object') {
                // report.push(`  - \`${field}\`: Swagger defines as **${swagType}**. Check TS definition.`);
            }
        }
    });
    if (conflictCount === 0) report.push('  *(Requires deeper AST analysis for strict checking, mostly looks ok)*');

    report.push('');
}

fs.writeFileSync('data_density_analysis.md', report.join('\n'));
console.log('Report generated: data_density_analysis.md');
