<?php
/**
 * Analyze Product Field Usage
 * 
 * Scans the entire product table and calculates the percentage of filled values for each column.
 * Helps identifying which fields are actually used.
 */

if (!defined("NOCSRFCHECK"))
    define("NOCSRFCHECK", 1);
if (!defined("NOTOKENRENEWAL"))
    define("NOTOKENRENEWAL", 1);
if (!defined('NOREQUIREMENU'))
    define('NOREQUIREMENU', '1');
if (!defined('NOREQUIREHTML'))
    define('NOREQUIREHTML', '1');
if (!defined('NOLOGIN'))
    define('NOLOGIN', '1');

require 'main.inc.php';

header('Content-Type: application/json');

$response = [
    'total_records' => 0,
    'fields' => []
];

// 1. Get all columns
$columns = [];
$sqlDesc = "DESCRIBE " . MAIN_DB_PREFIX . "product";
$resDesc = $db->query($sqlDesc);
if ($resDesc) {
    while ($row = $db->fetch_object($resDesc)) {
        $columns[] = $row->Field;
        $response['fields'][$row->Field] = [
            'filled_count' => 0,
            'non_zero_count' => 0,
            'usage_percent' => 0
        ];
    }
}

// 2. Scan Data
$sql = "SELECT * FROM " . MAIN_DB_PREFIX . "product";
$res = $db->query($sql);

if ($res) {
    $total = $db->num_rows($res);
    $response['total_records'] = $total;

    while ($obj = $db->fetch_object($res)) {
        foreach ($columns as $col) {
            $val = $obj->$col;

            // Check filled (not null, not empty string)
            if (!is_null($val) && (string) $val !== '') {
                $response['fields'][$col]['filled_count']++;
            }

            // Check non-zero (for numeric relevance)
            if (!is_null($val) && (string) $val !== '' && (string) $val !== '0' && (string) $val !== '0.00000000') {
                $response['fields'][$col]['non_zero_count']++;
            }
        }
    }

    // 3. Calculate Percentages
    if ($total > 0) {
        foreach ($response['fields'] as $col => &$stats) {
            $stats['usage_percent'] = round(($stats['filled_count'] / $total) * 100, 2);
            $stats['non_zero_percent'] = round(($stats['non_zero_count'] / $total) * 100, 2);
        }
    }

    // Sort by usage (filled_count desc)
    uasort($response['fields'], function ($a, $b) {
        return $b['filled_count'] <=> $a['filled_count'];
    });

} else {
    $response['error'] = $db->lasterror();
}

echo json_encode($response, JSON_PRETTY_PRINT);
?>