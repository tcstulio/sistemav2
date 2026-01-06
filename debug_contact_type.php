<?php
// Debug: Check Contact Type Source
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

$typeId = 45;

echo "--- INSPECTING CONTACT TYPE ID $typeId ---\n";

$sql = "SELECT rowid, element, source, code, libelle FROM " . MAIN_DB_PREFIX . "c_type_contact WHERE rowid = " . $typeId;
$resql = $db->query($sql);

if ($resql && $obj = $db->fetch_object($resql)) {
    echo "Type ID: " . $obj->rowid . "\n";
    echo "Element: " . $obj->element . "\n";
    echo "Source: " . $obj->source . " (internal = User, external = Contact)\n";
    echo "Code: " . $obj->code . "\n";
    echo "Label: " . $obj->libelle . "\n";

    if ($obj->source == 'internal') {
        echo "\n[CONCLUSION] Source is INTERNAL. This means llx_element_contact.fk_socpeople stores a USER ID (llx_user.rowid).\n";
    } else {
        echo "\n[CONCLUSION] Source is EXTERNAL. This means llx_element_contact.fk_socpeople stores a CONTACT ID (llx_socpeople.rowid).\n";
    }

} else {
    echo "Type ID $typeId not found.\n";
}
