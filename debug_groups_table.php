<?php
// Debug script to check usergroup table
define("NOCSRFCHECK", 1);
define("NOTOKENRENEWAL", 1);
define("NOREQUIREMENU", '1');
define("NOREQUIREHTML", '1');
define("NOREQUIREAJAX", '1');
define("NOLOGIN", '1');

require 'main.inc.php';

echo "Checking usergroup table...\n";

// 1. Check Table Structure (Does tms exist?)
$sql_desc = "DESCRIBE " . MAIN_DB_PREFIX . "usergroup";
$res_desc = $db->query($sql_desc);
if ($res_desc) {
    echo "Table found. Columns:\n";
    while ($col = $db->fetch_object($res_desc)) {
        echo "- " . $col->Field . " (" . $col->Type . ")\n";
    }
} else {
    echo "Error describing table: " . $db->lasterror() . "\n";
}

echo "\n-------------------\n";

// 2. Check Content (First 5 rows)
$sql_content = "SELECT rowid, nom, entity, datec, tms FROM " . MAIN_DB_PREFIX . "usergroup LIMIT 5";
$res_content = $db->query($sql_content);
if ($res_content) {
    $num = $db->num_rows($res_content);
    echo "Found " . $num . " rows.\n";
    while ($row = $db->fetch_object($res_content)) {
        echo "ID: " . $row->rowid . " | Name: " . $row->nom . " | DateC: " . $row->datec . " | TMS: " . $row->tms . "\n";
    }
} else {
    echo "Error fetching content: " . $db->lasterror() . "\n";
}
?>