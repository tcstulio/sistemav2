<?php
require_once 'main.inc.php';

// Inspect llx_paiement schema
$sql = "DESCRIBE " . MAIN_DB_PREFIX . "paiement";
$resql = $db->query($sql);

if ($resql) {
    echo "Columns in llx_paiement:\n";
    while ($obj = $db->fetch_object($resql)) {
        echo $obj->Field . " (" . $obj->Type . ")\n";
    }
} else {
    echo "Error: " . $db->lasterror();
}
?>