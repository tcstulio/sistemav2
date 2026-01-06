<?php
// Debug schema for element_contact
$res = 0;
if (!$res && file_exists("main.inc.php"))
    $res = @include 'main.inc.php';
if (!$res && file_exists("../main.inc.php"))
    $res = @include '../main.inc.php';
if (!$res && file_exists("../../main.inc.php"))
    $res = @include '../../main.inc.php';

if (!$res)
    die("Include main fail");

header('Content-Type: text/plain');

echo "Schema for " . MAIN_DB_PREFIX . "element_contact:\n";
$sql = "DESCRIBE " . MAIN_DB_PREFIX . "element_contact";
$resql = $db->query($sql);
if ($resql) {
    while ($obj = $db->fetch_object($resql)) {
        echo $obj->Field . " - " . $obj->Type . "\n";
    }
} else {
    echo "Error: " . $db->lasterror();
}

echo "\n\nSchema for " . MAIN_DB_PREFIX . "c_type_contact:\n";
$sql = "DESCRIBE " . MAIN_DB_PREFIX . "c_type_contact";
$resql = $db->query($sql);
if ($resql) {
    while ($obj = $db->fetch_object($resql)) {
        echo $obj->Field . " - " . $obj->Type . "\n";
    }
}
