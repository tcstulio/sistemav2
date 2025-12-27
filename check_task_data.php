<?php
// Place in Dolibarr root
if (!defined("NOCSRFCHECK"))
    define("NOCSRFCHECK", 1);
if (!defined("NOTOKENRENEWAL"))
    define("NOTOKENRENEWAL", 1);
if (!defined('NOREQUIREMENU'))
    define('NOREQUIREMENU', '1');
if (!defined('NOREQUIREHTML'))
    define('NOREQUIREHTML', '1');
require 'main.inc.php';

header('Content-Type: text/plain');

echo "Checking Task Descriptions...\n";
$sql = "SELECT rowid, ref, label, description, note_public, note_private FROM " . MAIN_DB_PREFIX . "projet_task LIMIT 10";
$res = $db->query($sql);
if ($res) {
    while ($obj = $db->fetch_object($res)) {
        echo "Validating Task ID: " . $obj->rowid . "\n";
        echo "Ref: " . $obj->ref . "\n";
        echo "Label: " . $obj->label . "\n";
        echo "Desc: " . substr($obj->description ?? '', 0, 50) . "...\n";
        echo "Note P: " . substr($obj->note_public ?? '', 0, 50) . "...\n";
        echo "Note Pr: " . substr($obj->note_private ?? '', 0, 50) . "...\n";
        echo "--------------------------------\n";
    }
} else {
    echo "Error: " . $db->lasterror();
}
?>