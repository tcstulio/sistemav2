<?php
// Debug: Identify Contacts by ID
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

$contactIds = "7, 8, 14, 45, 94, 112";

echo "--- IDENTIFYING CONTACTS ($contactIds) ---\n";

$sql = "SELECT rowid, firstname, lastname, email, statut FROM " . MAIN_DB_PREFIX . "socpeople WHERE rowid IN ($contactIds)";
$resql = $db->query($sql);

if ($resql) {
    while ($obj = $db->fetch_object($resql)) {
        echo "Contact ID: " . $obj->rowid . "\n";
        echo "   Name: " . $obj->firstname . " " . $obj->lastname . "\n";
        echo "   Email: " . $obj->email . "\n";
        echo "------------------------------------------------\n";
    }
}
