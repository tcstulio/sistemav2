<?php
// diagnostic_lines.php
require 'main.inc.php';

header('Content-Type: application/json');

$tables = ['propaldet', 'commandedet', 'facturedet', 'element_element'];
$report = [];

foreach ($tables as $t) {
    $full_table = MAIN_DB_PREFIX . $t;

    // 1. Check if table exists
    $sql_check = "SHOW TABLES LIKE '$full_table'";
    $res = $db->query($sql_check);

    if ($res && $db->num_rows($res) > 0) {
        $report[$t]['exists'] = true;

        // 2. Get Columns
        $sql_cols = "SHOW COLUMNS FROM $full_table";
        $res_cols = $db->query($sql_cols);
        $columns = [];
        if ($res_cols) {
            while ($c = $db->fetch_object($res_cols)) {
                $columns[] = $c->Field;
            }
        }
        $report[$t]['columns'] = $columns;
        $report[$t]['has_tms'] = in_array('tms', $columns);

        // 3. Try Sample Query (as used in custom_sync)
        if ($t === 'element_element') {
            $sql_test = "SELECT rowid as id FROM $full_table LIMIT 1";
        } else {
            // For lines, we tried to use tms
            if (in_array('tms', $columns)) {
                $sql_test = "SELECT rowid as id FROM $full_table WHERE tms >= '2000-01-01' LIMIT 1";
            } else {
                $sql_test = "SELECT rowid as id FROM $full_table LIMIT 1";
                $report[$t]['note'] = "Cannot use WHERE tms!";
            }
        }

        $res_test = $db->query($sql_test);
        if ($res_test) {
            $report[$t]['query_test'] = "OK";
            $report[$t]['count_test'] = $db->num_rows($res_test);
        } else {
            $report[$t]['query_test'] = "FAIL: " . $db->lasterror();
        }

    } else {
        $report[$t]['exists'] = false;
    }
}

echo json_encode($report, JSON_PRETTY_PRINT);
?>