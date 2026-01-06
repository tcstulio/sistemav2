<?php
require 'main.inc.php';

echo "1. Searching for specific password/user modification events:\n";
echo "---------------------------------------------------------\n";

$keywords = ['senha', 'password'];
$sql = "SELECT code, label FROM " . MAIN_DB_PREFIX . "actioncomm WHERE ";
$conditions = [];
foreach ($keywords as $k) {
    $conditions[] = "label LIKE '%" . $db->escape($k) . "%'";
}
$sql .= implode(' OR ', $conditions);
$sql .= " LIMIT 50";

$res = $db->query($sql);
if ($res) {
    echo "Found " . $db->num_rows($res) . " events:\n";
    while ($obj = $db->fetch_object($res)) {
        echo "Code: [" . ($obj->code ? $obj->code : 'NULL') . "] - Label: " . $obj->label . "\n";
    }
} else {
    echo "Error: " . $db->lasterror();
}

echo "\n2. Analyzing AC_OTH events (often used for generic logs):\n";
echo "---------------------------------------------------------\n";
$sql = "SELECT code, label FROM " . MAIN_DB_PREFIX . "actioncomm WHERE code = 'AC_OTH' LIMIT 20";
$res = $db->query($sql);
if ($res) {
    while ($obj = $db->fetch_object($res)) {
        echo "Code: [" . $obj->code . "] - Label: " . $obj->label . "\n";
    }
}
?>