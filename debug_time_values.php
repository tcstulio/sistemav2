<?php
require_once 'main.inc.php';
$sql = "SELECT element_duration, note FROM " . MAIN_DB_PREFIX . "element_time LIMIT 5";
$res = $db->query($sql);
while ($obj = $db->fetch_object($res)) {
    echo "Duration: " . $obj->element_duration . " Note: " . $obj->note . "\n";
}
