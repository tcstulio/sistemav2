<?php
require 'main.inc.php';
header('Content-Type: text/plain; charset=utf-8');

echo "=== DEBUGGING SYNC QUERY ===\n";

$last_modified = 0;
$date_filter = $db->idate($last_modified);
echo "Last Modified: $last_modified\n";
echo "Date Filter: $date_filter\n";

// Test Interventions Query
echo "\n--- Interventions ---\n";
$sql = "SELECT rowid as id, ref, fk_soc as socid, fk_projet as project_id, fk_user_author, duree as duration, UNIX_TIMESTAMP(datec) as date_creation, UNIX_TIMESTAMP(tms) as tms, description, fk_statut as statut";
$sql .= " FROM " . MAIN_DB_PREFIX . "fichinter";
$sql .= " WHERE tms >= '" . $date_filter . "'";
$sql .= " LIMIT 5";
echo "Query: $sql\n";
$res = $db->query($sql);
if ($res) {
    echo "Found: " . $db->num_rows($res) . "\n";
    while ($obj = $db->fetch_object($res)) {
        echo "Row: " . json_encode($obj) . "\n";
    }
} else {
    echo "Error: " . $db->lasterror() . "\n";
}

// Test Intervention Lines Query
echo "\n--- Intervention Lines ---\n";
// Removing d.qty as per fix
$sql = "SELECT d.rowid as id, d.fk_fichinter as parent_id, d.description, d.duree as duration, d.rang as rang, UNIX_TIMESTAMP(p.tms) as tms, UNIX_TIMESTAMP(p.tms) as parent_tms";
$sql .= " FROM " . MAIN_DB_PREFIX . "fichinterdet d";
$sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "fichinter p ON d.fk_fichinter = p.rowid";
$sql .= " WHERE p.tms >= '" . $date_filter . "'";
$sql .= " LIMIT 5";
echo "Query: $sql\n";
$res = $db->query($sql);
if ($res) {
    echo "Found: " . $db->num_rows($res) . "\n";
    while ($obj = $db->fetch_object($res)) {
        // Simulation of the UTF-8 fix I added to custom_sync.php
        foreach ($obj as $key => $value) {
            if (is_string($value) && !mb_check_encoding($value, 'UTF-8')) {
                $obj->$key = mb_convert_encoding($value, 'UTF-8', 'ISO-8859-1');
            }
        }
        echo "Row: " . json_encode($obj) . "\n";
    }
} else {
    echo "Error: " . $db->lasterror() . "\n";
}
?>