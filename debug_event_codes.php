<?php
require 'main.inc.php';

// Fetch distinct codes from actioncomm to identify system events
$sql = "SELECT DISTINCT code, label FROM " . MAIN_DB_PREFIX . "actioncomm ORDER BY code ASC";
$res = $db->query($sql);

if ($res) {
    echo "Distinct Event Codes found:\n";
    echo "---------------------------\n";
    while ($obj = $db->fetch_object($res)) {
        echo "Code: [" . ($obj->code ? $obj->code : 'NULL') . "] - Label Sample: " . substr($obj->label, 0, 50) . "\n";
    }
} else {
    echo "Error: " . $db->lasterror();
}
?>