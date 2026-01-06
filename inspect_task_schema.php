<?php
require 'main.inc.php';

echo "=== INSPECTING TASK SCHEMA ===\n";
$sql = "DESCRIBE " . MAIN_DB_PREFIX . "projet_task";
$res = $db->query($sql);
if ($res) {
    while ($obj = $db->fetch_object($res)) {
        echo $obj->Field . " (" . $obj->Type . ")\n";
    }
} else {
    echo "Error: " . $db->lasterror() . "\n";
}
?>