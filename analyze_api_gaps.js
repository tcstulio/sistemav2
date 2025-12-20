import fs from 'fs';

const swaggerPath = './swagger_full.json';
const servicePath = './services/dolibarrService.ts';

console.log('Loading Swagger...');
if (!fs.existsSync(swaggerPath)) {
    console.error('Swagger file not found!');
    process.exit(1);
}
const swagger = JSON.parse(fs.readFileSync(swaggerPath, 'utf8'));
const allPaths = Object.keys(swagger.paths).sort();

console.log('Loading Service Code...');
if (!fs.existsSync(servicePath)) {
    console.error('Service file not found!');
    process.exit(1);
}
const serviceCode = fs.readFileSync(servicePath, 'utf8');

const report = [];
report.push('# API Gap Analysis Report (Strict Mode)');
report.push(`Generated at: ${new Date().toISOString()}`);
report.push('');
report.push('This report compares Swagger paths against `dolibarrService.ts` using Regex matching.');

const grouped = {};

// Helper to check usage
function checkUsage(pathPattern) {
    // Convert Swagger path /products/{id}/stock to Regex
    // 1. Escape special chars except {}
    // 2. Replace {param} with regex for variable interpolation or string
    //    We expect code to look like: "products/" + id + "/stock" OR `products/${id}/stock`
    //    So / matches \/
    //    {id} matches (?:[^/"'`]+|\$\{[^}]+\}) basically "anything not a separator"

    let regexStr = pathPattern
        .substring(1) // remove leading /
        .replace(/\//g, '[\\/]') // match / literal
        .replace(/{[^}]+}/g, '(?:[^/]+|\\$\\{[^}]+\\})'); // match id or ${id}

    // Case 1: The path appears in a template literal or string
    // We allow some flexibility for spaces
    const re = new RegExp(regexStr, 'i');
    return re.test(serviceCode);
}

// Special overrides for known generic calls
// e.g. fetchList(config, 'invoices') matches /invoices
function checkGenericUsage(pathPattern) {
    if ((pathPattern.match(/\//g) || []).length === 1) {
        // Root resource like /invoices
        // Check for 'invoices' string literal specifically (quoted)
        const token = pathPattern.substring(1);
        if (serviceCode.includes(`'${token}'`) || serviceCode.includes(`"${token}"`)) {
            return true;
        }
    }
    return false;
}

allPaths.forEach(path => {
    const parts = path.split('/').filter(p => p);
    const group = parts[0] || 'root';
    if (!grouped[group]) grouped[group] = [];

    let isUsed = checkUsage(path);
    if (!isUsed) isUsed = checkGenericUsage(path);

    const methodInfo = swagger.paths[path];
    const summary = methodInfo.get ? methodInfo.get.summary : (methodInfo.post ? methodInfo.post.summary : 'No summary');
    const methods = Object.keys(methodInfo).filter(k => k !== 'parameters');

    grouped[group].push({
        path: path,
        used: isUsed,
        summary: summary || 'No summary',
        methods: methods
    });
});

for (const group of Object.keys(grouped).sort()) {
    report.push(`## Module: ${group.toUpperCase()}`);
    report.push('| Endpoint | Used? | Summary | Methods |');
    report.push('|---|---|---|---|');

    grouped[group].forEach(item => {
        report.push(`| \`${item.path}\` | ${item.used ? '✅' : '❌'} | ${item.summary} | ${item.methods.join(', ')} |`);
    });
    report.push('');
}

fs.writeFileSync('api_gap_analysis.md', report.join('\n'));
console.log('Report generated: api_gap_analysis.md');
