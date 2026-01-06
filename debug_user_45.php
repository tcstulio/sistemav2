<?php
// Debug: Inspect User 45 and Contact 45
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

$targetId = 45;

echo "--- INSPECTING USER ID $targetId ---\n";
$sql = "SELECT rowid, login, firstname, lastname, fk_socpeople, email FROM " . MAIN_DB_PREFIX . "user WHERE rowid = " . $targetId;
$resql = $db->query($sql);
if ($resql && $obj = $db->fetch_object($resql)) {
    echo "User Found:\n";
    echo "ID: " . $obj->rowid . "\n";
    echo "Login: " . $obj->login . "\n";
    echo "Name: " . $obj->firstname . " " . $obj->lastname . "\n";
    echo "Email: " . $obj->email . "\n";
    echo "Linked Contact ID (fk_socpeople): " . ($obj->fk_socpeople ? $obj->fk_socpeople : "NULL") . "\n";
} else {
    echo "User ID $targetId NOT FOUND in llx_user.\n";
}

echo "\n\n--- INSPECTING CONTACT ID $targetId ---\n";
$sql = "SELECT rowid, firstname, lastname, email, statut FROM " . MAIN_DB_PREFIX . "socpeople WHERE rowid = " . $targetId;
$resql = $db->query($sql);
if ($resql && $obj = $db->fetch_object($resql)) {
    echo "Contact Found:\n";
    echo "ID: " . $obj->rowid . "\n";
    echo "Name: " . $obj->firstname . " " . $obj->lastname . "\n";
    echo "Email: " . $obj->email . "\n";

    // Check if this contact is linked to ANY user
    $sqlUser = "SELECT rowid, login FROM " . MAIN_DB_PREFIX . "user WHERE fk_socpeople = " . $obj->rowid;
    $resUser = $db->query($sqlUser);
    if ($resUser && $userObj = $db->fetch_object($resUser)) {
        echo "-> LINKED TO USER: " . $userObj->login . " (ID: " . $userObj->rowid . ")\n";
    } else {
        echo "-> NOT LINKED to any system User.\n";
    }

} else {
    echo "Contact ID $targetId NOT FOUND in llx_socpeople.\n";
}

echo "\n\n--- INSPECTING ELEMENT CONTACT FOR TASK 689 AGAIN ---\n";
// Double check the raw values in element contact
$sql = "SELECT * FROM " . MAIN_DB_PREFIX . "element_contact WHERE element_id = 689 AND fk_socpeople = " . $targetId;
$resql = $db->query($sql);
if ($resql && $obj = $db->fetch_object($resql)) {
    echo "Found element_contact entry:\n";
    print_r($obj);
} else {
    echo "No element_contact found for Task 689 with fk_socpeople = $targetId\n";
}
