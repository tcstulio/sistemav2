<?php
// Debug Permissions and Group Rights Data

require 'main.inc.php'; // Load Dolibarr environment

header('Content-Type: text/plain');

echo "=== Debugging Permissions (llx_rights_def) ===\n";
$sql_perms = "SELECT id, libelle, module, perms, subperms, type FROM " . MAIN_DB_PREFIX . "rights_def LIMIT 5";
$res_perms = $db->query($sql_perms);

if ($res_perms) {
    echo "Query OK. Found " . $db->num_rows($res_perms) . " rows (showing first 5):\n";
    while ($obj = $db->fetch_object($res_perms)) {
        print_r($obj);
    }
} else {
    echo "Query FAILED: " . $db->lasterror() . "\n";
}

echo "\n=== Debugging Group Rights (llx_usergroup_rights) ===\n";
$sql_rights = "SELECT rowid as id, fk_usergroup, fk_id FROM " . MAIN_DB_PREFIX . "usergroup_rights LIMIT 5";
$res_rights = $db->query($sql_rights);

if ($res_rights) {
    echo "Query OK. Found " . $db->num_rows($res_rights) . " rows (showing first 5):\n";
    while ($obj = $db->fetch_object($res_rights)) {
        print_r($obj);
    }
} else {
    echo "Query FAILED: " . $db->lasterror() . "\n";
}

echo "\n=== Custom Sync Logic Simulation ===\n";
echo "Checking if TABLES match custom_sync.php expectations...\n";
// custom_sync.php permissions: id, libelle, module, perms, subperms, type, module_position, family_position
// custom_sync.php group_rights: rowid as id, fk_usergroup, fk_id

$sql_sync_perms = "SELECT id, libelle, module, perms, subperms, type, module_position, family_position FROM " . MAIN_DB_PREFIX . "rights_def LIMIT 1";
if ($db->query($sql_sync_perms)) {
    echo "[OK] Permissions table has all expected columns.\n";
} else {
    echo "[FAIL] Permissions table MISSING columns: " . $db->lasterror() . "\n";
}
