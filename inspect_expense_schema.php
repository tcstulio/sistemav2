<?php
require 'main.inc.php';

header('Content-Type: text/plain; charset=utf-8');

echo "=== INSPECTING EXPENSE REPORT SCHEMA ===\n";

// 1. Check expensereport (main table)
echo "\n[Table: llx_expensereport]\n";
$sql = "DESCRIBE " . MAIN_DB_PREFIX . "expensereport";
$res = $db->query($sql);
if ($res) {
    while ($obj = $db->fetch_object($res)) {
        echo $obj->Field . " (" . $obj->Type . ")\n";
    }
} else {
    echo "Error: " . $db->lasterror() . "\n";
}

// 2. Check expensereport_det (lines table)
echo "\n[Table: llx_expensereport_det]\n";
$sql = "DESCRIBE " . MAIN_DB_PREFIX . "expensereport_det";
$res = $db->query($sql);
if ($res) {
    while ($obj = $db->fetch_object($res)) {
        echo $obj->Field . " (" . $obj->Type . ")\n";
    }
} else {
    echo "Error: " . $db->lasterror() . "\n";
}

// 3. Check types of fees/expenses
echo "\n[Table: llx_c_type_fees]\n";
$sql = "DESCRIBE " . MAIN_DB_PREFIX . "c_type_fees";
$res = $db->query($sql);
if ($res) {
    while ($obj = $db->fetch_object($res)) {
        echo $obj->Field . " (" . $obj->Type . ")\n";
    }
}
?>