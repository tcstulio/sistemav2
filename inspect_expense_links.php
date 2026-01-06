<?php
require 'main.inc.php';

header('Content-Type: text/plain; charset=utf-8');

echo "=== INSPECTING EXPENSE REPORT LINKS ===\n";

// 1. Check if link table exists
$tableName = MAIN_DB_PREFIX . "paymentexpensereport_expensereport";
echo "Checking table: $tableName\n";
$sql = "DESCRIBE $tableName";
$res = $db->query($sql);
if ($res) {
    echo "Table $tableName EXISTS.\n";
    while ($obj = $db->fetch_object($res)) {
        echo "  " . $obj->Field . "\n";
    }
} else {
    echo "Table $tableName DOES NOT EXIST (or error: " . $db->lasterror() . ")\n";
}

// 2. Test the expense_report_payments Query (simulating custom_sync)
echo "\n[Testing expense_report_payments Query]\n";
// Default last_modified = 0
$last_modified = 0;
// Logic from custom_sync.php
$sql = "SELECT rowid as id, num_payment as ref, fk_expensereport, UNIX_TIMESTAMP(datep) as date_payment, amount, fk_bank, fk_user_creat, UNIX_TIMESTAMP(tms) as tms";
$sql .= " FROM " . MAIN_DB_PREFIX . "payment_expensereport";
$sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
$sql .= " LIMIT 5";

echo "Query: $sql\n";
$res = $db->query($sql);
if ($res) {
    echo "Found " . $db->num_rows($res) . " rows:\n";
    while ($obj = $db->fetch_object($res)) {
        print_r($obj);
    }
} else {
    echo "Error: " . $db->lasterror() . "\n";
}
?>