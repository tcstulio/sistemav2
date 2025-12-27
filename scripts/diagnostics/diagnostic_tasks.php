<?php
// diagnostic_tasks.php
require 'main.inc.php';
header('Content-Type: application/json');

$table = MAIN_DB_PREFIX . 'projet_task';
$report = [];

// 1. Check Columns
$sql_cols = "SHOW COLUMNS FROM $table";
$res_cols = $db->query($sql_cols);
$columns = [];
if ($res_cols) {
    while ($c = $db->fetch_object($res_cols)) {
        $columns[] = $c->Field;
    }
}
$report['columns'] = $columns;
$report['has_fk_parent'] = in_array('fk_parent', $columns);
$report['has_tms'] = in_array('tms', $columns);

// 2. Test Query
$sql = "SELECT rowid FROM $table LIMIT 1";
$res = $db->query($sql);
if ($res) {
    $report['query_ok'] = true;
    $report['count'] = $db->num_rows($res);
} else {
    $report['query_error'] = $db->lasterror();
}

echo json_encode($report, JSON_PRETTY_PRINT);
?>