<?php
require 'main.inc.php';

// Force UTF-8 header
header('Content-Type: text/plain; charset=utf-8');

echo "=== DEBUGGING EXPENSE REPORT PAYMENTS ===\n";

// 1. Check Table Structure
echo "\n[Table Structure: llx_payment_expensereport]\n";
$sql = "DESCRIBE " . MAIN_DB_PREFIX . "payment_expensereport";
echo "Query: $sql\n";
$res = $db->query($sql);
if ($res) {
    while ($obj = $db->fetch_object($res)) {
        echo $obj->Field . " (" . $obj->Type . ")\n";
    }
} else {
    echo "Error: " . $db->lasterror() . "\n";
}

// 2. Check Data
echo "\n[Data Sample: llx_payment_expensereport]\n";
$sql = "SELECT * FROM " . MAIN_DB_PREFIX . "payment_expensereport LIMIT 5";
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

// 3. Check Expense Reports
echo "\n[Data Sample: llx_expensereport]\n";
$sql = "SELECT rowid, ref FROM " . MAIN_DB_PREFIX . "expensereport LIMIT 5";
echo "Query: $sql\n";
$res = $db->query($sql);
if ($res) {
    echo "Found " . $db->num_rows($res) . " rows:\n";
    while ($obj = $db->fetch_object($res)) {
        echo "ID: " . $obj->rowid . " | Ref: " . $obj->ref . "\n";
    }
} else {
    echo "Error: " . $db->lasterror() . "\n";
}
?>