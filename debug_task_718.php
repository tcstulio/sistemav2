<?php
// Load Dolibarr environment
if (!defined("NOCSRFCHECK"))
    define("NOCSRFCHECK", 1);
if (!defined("NOTOKENRENEWAL"))
    define("NOTOKENRENEWAL", 1);
if (!defined('NOREQUIREMENU'))
    define('NOREQUIREMENU', '1');
if (!defined('NOREQUIREHTML'))
    define('NOREQUIREHTML', '1');
if (!defined('NOREQUIREAJAX'))
    define('NOREQUIREAJAX', '1');
if (!defined('NOLOGIN'))
    define('NOLOGIN', '1');

require 'main.inc.php';

$taskId = 718;
$sql = "SELECT rowid, description, note_public, note_private FROM " . MAIN_DB_PREFIX . "projet_task WHERE rowid = " . $taskId;

$res = $db->query($sql);
if ($res) {
    if ($obj = $db->fetch_object($res)) {
        echo "\n=== DATA FOR TASK ID $taskId ===\n";
        echo "description (Used by Custom Sync): [" . $obj->description . "]\n";
        echo "note_public: [" . $obj->note_public . "]\n";
        echo "note_private: [" . $obj->note_private . "]\n";
        echo "==================================\n";
    } else {
        echo "Task ID $taskId not found.\n";
    }
} else {
    echo "SQL Error: " . $db->lasterror();
}
?>