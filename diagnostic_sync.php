<?php
/**
 * Diagnostic Script for Delta Sync
 * 
 * Tests all endpoints and shows detailed error information
 * Usage: GET /diagnostic_sync.php?DOLAPIKEY=...
 */

// 1. Load Dolibarr environment
if (!defined("NOCSRFCHECK"))
    define("NOCSRFCHECK", 1);
if (!defined("NOTOKENRENEWAL"))
    define("NOTOKENRENEWAL", 1);
if (!defined('NOREQUIREMENU'))
    define('NOREQUIREMENU', '1');
if (!defined('NOREQUIREHTML'))
    define('NOREQUIREHTML', '1');
if (!defined('NOREQUIREAJAX'))
    define('NOREQUIREAJAX', '1');
if (!defined('NOLOGIN'))
    define('NOLOGIN', '1');

require 'main.inc.php';

// 2. Authentication
$apikey = GETPOST('DOLAPIKEY', 'none');
if (empty($apikey)) {
    $headers = apache_request_headers();
    if (!empty($headers['DOLAPIKEY'])) {
        $apikey = $headers['DOLAPIKEY'];
    }
}
$apikey = trim($apikey);

if (empty($apikey)) {
    http_response_code(401);
    print json_encode(['error' => 'Missing API Key']);
    exit;
}

$foundUser = null;
$sql_users = "SELECT rowid FROM " . MAIN_DB_PREFIX . "user WHERE statut = 1";
$res_users = $db->query($sql_users);

if ($res_users) {
    while ($u = $db->fetch_object($res_users)) {
        $tmp_user = new User($db);
        $tmp_user->fetch($u->rowid);
        if ($tmp_user->api_key === $apikey) {
            $foundUser = $tmp_user;
            break;
        }
    }
}

if (!$foundUser) {
    http_response_code(401);
    print json_encode(['error' => 'Invalid API Key']);
    exit;
}

header('Content-Type: application/json');

// 3. Define all module queries with their table names
$modules = [
    'categories' => [
        'table' => 'categorie',
        'sql' => "SELECT rowid as id FROM " . MAIN_DB_PREFIX . "categorie LIMIT 5"
    ],
    'shipments' => [
        'table' => 'expedition',
        'sql' => "SELECT rowid as id FROM " . MAIN_DB_PREFIX . "expedition LIMIT 5"
    ],
    'supplier_orders' => [
        'table' => 'commande_fournisseur',
        'sql' => "SELECT rowid as id FROM " . MAIN_DB_PREFIX . "commande_fournisseur LIMIT 5"
    ],
    'interventions' => [
        'table' => 'fichinter',
        'sql' => "SELECT rowid as id FROM " . MAIN_DB_PREFIX . "fichinter LIMIT 5"
    ],
    'expense_reports' => [
        'table' => 'expensereport',
        'sql' => "SELECT rowid as id FROM " . MAIN_DB_PREFIX . "expensereport LIMIT 5"
    ],
    'job_positions' => [
        'table' => 'hrm_job',
        'sql' => "SELECT rowid as id FROM " . MAIN_DB_PREFIX . "hrm_job LIMIT 5"
    ],
    'candidates' => [
        'table' => 'recruitment_recruitmentcandidature',
        'sql' => "SELECT rowid as id FROM " . MAIN_DB_PREFIX . "recruitment_recruitmentcandidature LIMIT 5"
    ],
    'leave_requests' => [
        'table' => 'holiday',
        'sql' => "SELECT rowid as id FROM " . MAIN_DB_PREFIX . "holiday LIMIT 5"
    ],
    'contracts' => [
        'table' => 'contrat',
        'sql' => "SELECT rowid as id FROM " . MAIN_DB_PREFIX . "contrat LIMIT 5"
    ],
    'payments' => [
        'table' => 'paiement',
        'sql' => "SELECT rowid as id FROM " . MAIN_DB_PREFIX . "paiement LIMIT 5"
    ],
    'supplier_payments' => [
        'table' => 'paiementfourn',
        'sql' => "SELECT rowid as id FROM " . MAIN_DB_PREFIX . "paiementfourn LIMIT 5"
    ],
    'boms' => [
        'table' => 'bom_bom',
        'sql' => "SELECT rowid as id FROM " . MAIN_DB_PREFIX . "bom_bom LIMIT 5"
    ],
    'manufacturing_orders' => [
        'table' => 'mrp_mo',
        'sql' => "SELECT rowid as id FROM " . MAIN_DB_PREFIX . "mrp_mo LIMIT 5"
    ]
];

// 4. Test each module
$results = [];

foreach ($modules as $type => $config) {
    $result = [
        'type' => $type,
        'table' => $config['table'],
        'status' => 'unknown',
        'count' => 0,
        'error' => null,
        'table_exists' => false
    ];

    // First check if table exists
    $check_sql = "SHOW TABLES LIKE '" . MAIN_DB_PREFIX . $config['table'] . "'";
    $check_res = $db->query($check_sql);

    if ($check_res && $db->num_rows($check_res) > 0) {
        $result['table_exists'] = true;

        // Now try to count records
        $count_sql = "SELECT COUNT(*) as total FROM " . MAIN_DB_PREFIX . $config['table'];
        $count_res = $db->query($count_sql);

        if ($count_res) {
            $row = $db->fetch_object($count_res);
            $result['count'] = (int) $row->total;
            $result['status'] = $result['count'] > 0 ? 'has_data' : 'empty';
        } else {
            $result['status'] = 'query_error';
            $result['error'] = $db->lasterror();
        }
    } else {
        $result['status'] = 'table_not_found';
        $result['error'] = "Table " . MAIN_DB_PREFIX . $config['table'] . " does not exist";
    }

    $results[] = $result;
}

// 6. Special Analysis for Events (System Logs)
$event_analysis = [
    'total_events' => 0,
    'distinct_codes' => [],
    'system_logs_detected' => [],
    'current_filter_effectiveness' => []
];

if ($db) {
    // A. Count total events
    $sql_total = "SELECT COUNT(*) as total FROM " . MAIN_DB_PREFIX . "actioncomm";
    $res_total = $db->query($sql_total);
    if ($res_total) {
        $event_analysis['total_events'] = (int) $db->fetch_object($res_total)->total;
    }

    // B. Get all distinct codes and their counts
    $sql_codes = "SELECT code, COUNT(*) as c FROM " . MAIN_DB_PREFIX . "actioncomm GROUP BY code ORDER BY c DESC";
    $res_codes = $db->query($sql_codes);
    if ($res_codes) {
        while ($obj = $db->fetch_object($res_codes)) {
            $code = $obj->code;
            $count = $obj->c;
            $event_analysis['distinct_codes'][] = ['code' => $code, 'count' => $count];

            // C. Check if this code is currently filtered
            // Current filter: code IS NULL OR (code NOT LIKE '%_AUTO' AND code NOT LIKE '%_MODIFY' AND code NOT LIKE '%_CREATE' AND code NOT LIKE '%_DELETE' AND code NOT LIKE '%_VALIDATE')
            $is_filtered = false;
            if ($code) {
                if (
                    strpos($code, '_AUTO') !== false ||
                    strpos($code, '_MODIFY') !== false ||
                    strpos($code, '_CREATE') !== false ||
                    strpos($code, '_DELETE') !== false ||
                    strpos($code, '_VALIDATE') !== false
                ) {
                    $is_filtered = true;
                }
            }

            if (!$is_filtered && $code && strpos($code, 'AC_') === 0) {
                // Flag potential system logs that are NOT filtered
                $event_analysis['system_logs_detected'][] = $code;
            }
        }
    }
}

// 5. Summary
$summary = [
    'total_modules' => count($modules),
    'tables_found' => count(array_filter($results, fn($r) => $r['table_exists'])),
    'tables_with_data' => count(array_filter($results, fn($r) => $r['count'] > 0)),
    'tables_empty' => count(array_filter($results, fn($r) => $r['table_exists'] && $r['count'] == 0)),
    'tables_missing' => count(array_filter($results, fn($r) => !$r['table_exists']))
];

echo json_encode([
    'summary' => $summary,
    'event_analysis' => $event_analysis,
    'details' => $results
], JSON_PRETTY_PRINT);
?>