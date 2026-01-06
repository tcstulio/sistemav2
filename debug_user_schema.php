<?php
// Debug schema for user and socpeople
$res = 0;
if (!$res && file_exists("main.inc.php"))
    $res = @include 'main.inc.php'; // Check current dir first
if (!$res && file_exists("../main.inc.php"))
    $res = @include '../main.inc.php';
if (!$res && file_exists("../../main.inc.php"))
    $res = @include '../../main.inc.php';

if (!$res)
    die("Include main fail");

header('Content-Type: text/plain');

echo "Schema for " . MAIN_DB_PREFIX . "user:\n";
$sql = "DESCRIBE " . MAIN_DB_PREFIX . "user";
$resql = $db->query($sql);
if ($resql) {
    while ($obj = $db->fetch_object($resql)) {
        echo $obj->Field . " - " . $obj->Type . "\n";
    }
}

echo "\n\nSchema for " . MAIN_DB_PREFIX . "socpeople:\n";
$sql = "DESCRIBE " . MAIN_DB_PREFIX . "socpeople";
$resql = $db->query($sql);
if ($resql) {
    while ($obj = $db->fetch_object($resql)) {
        echo $obj->Field . " - " . $obj->Type . "\n";
    }
}