<?php
// Debug script to check llx_rights_def table
require 'main.inc.php';

echo "Checking llx_rights_def table...\n";

$sql = "SELECT rowid, module, perms, subperms, libelle, type FROM " . MAIN_DB_PREFIX . "rights_def LIMIT 5";
$resql = $db->query($sql);

if ($resql) {
    echo "Query successful. Found " . $db->num_rows($resql) . " rights.\n";
    while ($obj = $db->fetch_object($resql)) {
        print_r($obj);
        echo "\n";
    }
} else {
    echo "Query failed: " . $db->lasterror();
}

echo "\nChecking rights_def columns...\n";
$sqlDesc = "DESCRIBE " . MAIN_DB_PREFIX . "rights_def";
$resDesc = $db->query($sqlDesc);
if ($resDesc) {
    while ($obj = $db->fetch_object($resDesc)) {
        echo $obj->Field . " - " . $obj->Type . "\n";
    }
}
?>