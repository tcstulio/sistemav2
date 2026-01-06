<?php
require 'main.inc.php';

// Force UTF-8 header
header('Content-Type: text/plain; charset=utf-8');

echo "=== DEBUGGING INTERVENTIONS ===\n";

// 1. Check Main Interventions
echo "\n[Interventions SQL Request]\n";
$sql = "SELECT rowid as id, ref, description, duree FROM " . MAIN_DB_PREFIX . "fichinter LIMIT 5";
echo "Query: $sql\n";
$res = $db->query($sql);
if ($res) {
    echo "Found " . $db->num_rows($res) . " rows:\n";
    while ($obj = $db->fetch_object($res)) {
        echo "ID: " . $obj->id . " | Ref: " . $obj->ref . " | Desc: '" . substr($obj->description, 0, 50) . "...' | Duree: " . $obj->duree . "\n";
    }
} else {
    echo "Error: " . $db->lasterror() . "\n";
}

// 2. Check Intervention Lines
echo "\n[Intervention Lines SQL Request]\n";
// Using the same join logic as custom_sync just in case, but simplified for debug
$sql = "SELECT d.rowid as id, d.description, d.duree FROM " . MAIN_DB_PREFIX . "fichinterdet d LIMIT 5";
echo "Query: $sql\n";
$res = $db->query($sql);
if ($res) {
    echo "Found " . $db->num_rows($res) . " rows:\n";
    while ($obj = $db->fetch_object($res)) {
        echo "ID: " . $obj->id . " | Desc: '" . substr($obj->description, 0, 50) . "...' | Duree: " . $obj->duree . "\n";
    }
} else {
    echo "Error: " . $db->lasterror() . "\n";
}
?>