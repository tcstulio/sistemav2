<?php
require_once 'main.inc.php';
$sql = "DESCRIBE " . MAIN_DB_PREFIX . "element_time";
$res = $db->query($sql);
echo "Schema of element_time:\n";
while ($obj = $db->fetch_object($res)) {
    echo "$obj->Field ($obj->Type)\n";
}
