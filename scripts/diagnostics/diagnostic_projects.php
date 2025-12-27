<?php
// diagnostic_projects.php
require 'main.inc.php';
header('Content-Type: application/json');

$table = MAIN_DB_PREFIX . 'projet';
$report = [];

// Check columns
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
$report['has_parent'] = in_array('parent', $columns); // Just in case

echo json_encode($report, JSON_PRETTY_PRINT);
?>