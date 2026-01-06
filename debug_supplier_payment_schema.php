<?php
// ... standard dolibarr include ...
require '../main.inc.php';

echo "Checking schema for llx_paiementfourn...\n";
$sql = "DESCRIBE " . MAIN_DB_PREFIX . "paiementfourn";
$res = $db->query($sql);
if ($res) {
    while ($row = $db->fetch_object($res)) {
        echo $row->Field . "\n";
    }
} else {
    echo "Error: " . $db->lasterror();
}
?>