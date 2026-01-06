<?php
// Debug User 5 details
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

$userId = 5;
echo "Checking details for User ID: $userId\n\n";

$sql = "SELECT rowid, login, firstname, lastname, fk_socpeople FROM " . MAIN_DB_PREFIX . "user WHERE rowid = " . $userId;
$resql = $db->query($sql);
if ($resql) {
    if ($obj = $db->fetch_object($resql)) {
        echo "User Found:\n";
        echo "ID: " . $obj->rowid . "\n";
        echo "Login: " . $obj->login . "\n";
        echo "Name: " . $obj->firstname . " " . $obj->lastname . "\n";
        echo "Linked Contact ID (fk_socpeople): " . ($obj->fk_socpeople ? $obj->fk_socpeople : "NULL") . "\n";

        if (!$obj->fk_socpeople) {
            echo "\n[WARNING] This user is NOT linked to a Dolibarr Contact (socpeople).\n";
            echo "They cannot be added as a 'Participant' -> 'Task Contact' without this link.\n";
            echo "They can only be 'Assigned' directly via the Task card.\n";
        }
    } else {
        echo "User not found.\n";
    }
} else {
    echo "Error: " . $db->lasterror();
}
