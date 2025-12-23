/**
 * Comprehensive Date Handling Test Script
 * 
 * Tests all custom_sync.php endpoints and analyzes date formats
 */

import axios from 'axios';
import { config } from '../config/env';

// All entity types supported by custom_sync.php
const ALL_ENTITY_TYPES = [
    'thirdparties',
    'proposals',
    'orders',
    'invoices',
    'contracts',
    'products',
    'tickets',
    'projects',
    'events',
    'system_logs',
    'tasks',
    'suppliers',
    'contacts',
    'users',
    'warehouses',
    'supplier_orders',
    'supplier_invoices',
    'shipments',
    'bank_accounts',
    'expense_reports',
    'interventions',
    'categories',
    'boms',
    'manufacturing_orders',
    'stock_movements',
    'leave_requests',
    'job_positions',
    'candidates',
    'bank_lines',
    'payments',
    'supplier_payments',
];

// Date fields we expect to find in each entity
const EXPECTED_DATE_FIELDS: Record<string, string[]> = {
    thirdparties: ['tms', 'datec'],
    proposals: ['datec', 'tms'],
    orders: ['date_commande', 'datec', 'tms'],
    invoices: ['date_invoice', 'date_lim_reglement', 'datec', 'tms'],
    contracts: ['date_contrat', 'date_fin_validite', 'tms'],
    products: ['datec', 'tms'],
    tickets: ['datec', 'tms'],
    projects: ['datec', 'date_start', 'date_end', 'tms'],
    events: ['date_start', 'date_end', 'datec', 'tms'],
    system_logs: ['date_action', 'datec', 'tms'],
    tasks: ['date_start', 'date_end', 'datec', 'tms'],
    suppliers: ['tms', 'datec'],
    contacts: ['datec', 'tms'],
    users: ['datec', 'tms'],
    warehouses: ['datec', 'tms'],
    supplier_orders: ['date_creation', 'date_livraison', 'tms'],
    supplier_invoices: ['date_invoice', 'datec', 'tms'],
    shipments: ['date_creation', 'date_delivery', 'tms'],
    bank_accounts: ['datec', 'tms'],
    expense_reports: ['date_debut', 'date_fin', 'tms'],
    interventions: ['date_creation', 'tms'],
    categories: ['tms'],
    boms: ['datec', 'tms'],
    manufacturing_orders: ['date_start', 'date_end', 'datec', 'tms'],
    stock_movements: ['datem', 'tms'],
    leave_requests: ['date_debut', 'date_fin', 'datec', 'tms'],
    job_positions: ['datec', 'tms'],
    candidates: ['tms', 'datec'],
    bank_lines: ['date_operation', 'date_value', 'tms'],
    payments: ['date_payment', 'tms'],
    supplier_payments: ['date_payment', 'tms'],
};

interface DateAnalysis {
    field: string;
    rawValue: any;
    type: string;
    isValidTimestamp: boolean;
    assumedUnit: 'seconds' | 'milliseconds' | 'unknown';
    convertedDate: string | null;
}

interface EntityResult {
    type: string;
    status: 'success' | 'error' | 'empty';
    count: number;
    sampleDateAnalysis: DateAnalysis[];
    missingExpectedFields: string[];
    unexpectedDateFields: string[];
    error?: string;
}

function analyzeDateField(fieldName: string, value: any): DateAnalysis {
    const analysis: DateAnalysis = {
        field: fieldName,
        rawValue: value,
        type: typeof value,
        isValidTimestamp: false,
        assumedUnit: 'unknown',
        convertedDate: null,
    };

    if (value === null || value === undefined || value === '') {
        return analysis;
    }

    // Convert string to number if needed
    let numValue = value;
    if (typeof value === 'string' && /^\d+$/.test(value)) {
        numValue = Number(value);
        analysis.type = 'string (numeric)';
    }

    if (typeof numValue === 'number' && !isNaN(numValue)) {
        analysis.isValidTimestamp = true;

        // Check if seconds or milliseconds
        // 100 billion = ~year 5138 in seconds, ~year 1973 in ms
        if (numValue < 100000000000) {
            analysis.assumedUnit = 'seconds';
            analysis.convertedDate = new Date(numValue * 1000).toISOString();
        } else {
            analysis.assumedUnit = 'milliseconds';
            analysis.convertedDate = new Date(numValue).toISOString();
        }
    }

    return analysis;
}

function extractDateFields(obj: any): string[] {
    const dateFieldPatterns = [
        /date/i, /tms/i, /datec/i, /datep/i, /dateo/i, /datee/i, /datef/i,
        /datem/i, /datev/i, /time/i, /created/i, /modified/i
    ];

    return Object.keys(obj).filter(key =>
        dateFieldPatterns.some(pattern => pattern.test(key))
    );
}

async function testEntity(type: string, syncUrl: string, apiKey: string): Promise<EntityResult> {
    try {
        const response = await axios.get(syncUrl, {
            params: {
                type,
                last_modified: 0,
                limit: 5, // Just get a few samples
                DOLAPIKEY: apiKey
            },
            validateStatus: () => true
        });

        if (response.status !== 200) {
            return {
                type,
                status: 'error',
                count: 0,
                sampleDateAnalysis: [],
                missingExpectedFields: [],
                unexpectedDateFields: [],
                error: `HTTP ${response.status}: ${JSON.stringify(response.data)}`
            };
        }

        // Handle new response format with pagination
        const data = response.data?.data || response.data;

        if (!Array.isArray(data)) {
            return {
                type,
                status: 'error',
                count: 0,
                sampleDateAnalysis: [],
                missingExpectedFields: [],
                unexpectedDateFields: [],
                error: `Response is not an array: ${JSON.stringify(response.data).substring(0, 200)}`
            };
        }

        if (data.length === 0) {
            return {
                type,
                status: 'empty',
                count: 0,
                sampleDateAnalysis: [],
                missingExpectedFields: EXPECTED_DATE_FIELDS[type] || [],
                unexpectedDateFields: []
            };
        }

        // Analyze the first item
        const sample = data[0];
        const dateFields = extractDateFields(sample);
        const expectedFields = EXPECTED_DATE_FIELDS[type] || [];

        // Analyze each date field
        const sampleDateAnalysis: DateAnalysis[] = [];
        for (const field of dateFields) {
            sampleDateAnalysis.push(analyzeDateField(field, sample[field]));
        }

        // Find missing expected fields
        const presentFields = Object.keys(sample);
        const missingExpectedFields = expectedFields.filter(f => !presentFields.includes(f));

        // Find unexpected date fields
        const unexpectedDateFields = dateFields.filter(f => !expectedFields.includes(f));

        return {
            type,
            status: 'success',
            count: data.length,
            sampleDateAnalysis,
            missingExpectedFields,
            unexpectedDateFields
        };

    } catch (error: any) {
        return {
            type,
            status: 'error',
            count: 0,
            sampleDateAnalysis: [],
            missingExpectedFields: [],
            unexpectedDateFields: [],
            error: error.message
        };
    }
}

async function main() {
    const baseUrl = config.dolibarrUrl.replace(/\/api\/index\.php$/, '');
    const syncUrl = `${baseUrl}/custom_sync.php`;
    const apiKey = config.dolibarrKey;

    console.log('╔════════════════════════════════════════════════════════════════════╗');
    console.log('║            COMPREHENSIVE DATE HANDLING TEST                        ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝');
    console.log(`\nTarget URL: ${syncUrl}`);
    console.log(`API Key present: ${!!apiKey}`);
    console.log(`Current time: ${new Date().toISOString()}`);
    console.log(`\nTesting ${ALL_ENTITY_TYPES.length} entity types...\n`);

    const results: EntityResult[] = [];

    for (const entityType of ALL_ENTITY_TYPES) {
        process.stdout.write(`Testing ${entityType.padEnd(25)}... `);
        const result = await testEntity(entityType, syncUrl, apiKey);
        results.push(result);

        if (result.status === 'success') {
            console.log(`✓ ${result.count} items, ${result.sampleDateAnalysis.length} date fields`);
        } else if (result.status === 'empty') {
            console.log('○ No data');
        } else {
            console.log(`✗ ${result.error?.substring(0, 50)}`);
        }
    }

    // Summary Report
    console.log('\n╔════════════════════════════════════════════════════════════════════╗');
    console.log('║                        SUMMARY REPORT                              ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝\n');

    const successful = results.filter(r => r.status === 'success');
    const empty = results.filter(r => r.status === 'empty');
    const failed = results.filter(r => r.status === 'error');

    console.log(`✓ Successful: ${successful.length}`);
    console.log(`○ Empty: ${empty.length}`);
    console.log(`✗ Failed: ${failed.length}\n`);

    // Date Field Analysis
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('DATE FIELD ANALYSIS (from successful entities with data)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    for (const result of successful) {
        console.log(`\n▶ ${result.type.toUpperCase()}`);
        console.log('  Date fields found:');

        for (const analysis of result.sampleDateAnalysis) {
            const status = analysis.isValidTimestamp ? '✓' : '⚠';
            console.log(`    ${status} ${analysis.field}:`);
            console.log(`      Raw: ${analysis.rawValue} (${analysis.type})`);
            if (analysis.isValidTimestamp) {
                console.log(`      Unit: ${analysis.assumedUnit}`);
                console.log(`      Parsed: ${analysis.convertedDate}`);
            }
        }

        if (result.missingExpectedFields.length > 0) {
            console.log(`  ⚠ Missing expected: ${result.missingExpectedFields.join(', ')}`);
        }
        if (result.unexpectedDateFields.length > 0) {
            console.log(`  ℹ Unexpected date fields: ${result.unexpectedDateFields.join(', ')}`);
        }
    }

    // Error Details
    if (failed.length > 0) {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('FAILED ENTITIES');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        for (const result of failed) {
            console.log(`✗ ${result.type}: ${result.error}`);
        }
    }

    // Unit Consistency Check
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TIMESTAMP UNIT CONSISTENCY CHECK');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const allDateAnalyses = successful.flatMap(r => r.sampleDateAnalysis);
    const secondsCount = allDateAnalyses.filter(a => a.assumedUnit === 'seconds').length;
    const msCount = allDateAnalyses.filter(a => a.assumedUnit === 'milliseconds').length;
    const unknownCount = allDateAnalyses.filter(a => a.assumedUnit === 'unknown').length;

    console.log(`Timestamps in SECONDS: ${secondsCount}`);
    console.log(`Timestamps in MILLISECONDS: ${msCount}`);
    console.log(`Unknown/null: ${unknownCount}`);

    if (msCount > 0 && secondsCount > 0) {
        console.log('\n⚠ WARNING: Mixed timestamp units detected! This may cause issues.');
    } else if (secondsCount > 0 && msCount === 0) {
        console.log('\n✓ All timestamps are consistently in SECONDS (PHP/MySQL standard).');
        console.log('  Frontend toTimestamp() correctly converts to milliseconds for JavaScript.');
    }

    console.log('\n════════════════════════════════════════════════════════════════════');
    console.log('                          TEST COMPLETE');
    console.log('════════════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
