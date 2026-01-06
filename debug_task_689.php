<?php
// Debug: Inspect Task 689
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

$taskId = 689;

echo "--- INSPECTING TASK $taskId ---\n\n";

// 1. Task Attributes
$sql = "SELECT t.rowid, t.label, t.description, t.fk_user_valid, t.fk_user_creat, t.fk_projet, p.title as project_title";
$sql .= " FROM " . MAIN_DB_PREFIX . "projet_task t";
$sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "projet p ON t.fk_projet = p.rowid";
$sql .= " WHERE t.rowid = " . $taskId;

$resql = $db->query($sql);
if ($resql && $obj = $db->fetch_object($resql)) {
    echo "Task Label: " . $obj->label . "\n";
    echo "Project: " . $obj->project_title . " (ID: " . $obj->fk_projet . ")\n";
    echo "Assigned User ID: " . ($obj->fk_user_valid ? $obj->fk_user_valid : "None") . "\n";
    echo "Creator User ID: " . $obj->fk_user_creat . "\n";

    // Check Assignee Name if exists
    if ($obj->fk_user_valid) {
        $u = new User($db);
        $u->fetch($obj->fk_user_valid);
        echo "   -> Assigned Name: " . $u->firstname . " " . $u->lastname . " (Login: " . $u->login . ")\n";
    }
} else {
    echo "Task $taskId not found.\n";
    exit;
}

echo "\n--- PARTICIPANTS (Contacts) ---\n";

// 2. Linked Contacts
$sql = "SELECT ec.rowid, ec.fk_socpeople, tc.code, tc.libelle, sp.firstname, sp.lastname, sp.email, u.rowid as linked_user_id, u.login as linked_user_login";
$sql .= " FROM " . MAIN_DB_PREFIX . "element_contact ec";
$sql .= " INNER JOIN " . MAIN_DB_PREFIX . "c_type_contact tc ON ec.fk_c_type_contact = tc.rowid";
$sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "socpeople sp ON ec.fk_socpeople = sp.rowid";
$sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "user u ON sp.rowid = u.fk_socpeople";
// Note: Join user ON sp.rowid = u.fk_socpeople checks if this contact is linked to a user
$sql .= " WHERE ec.element_id = " . $taskId;
$sql .= " AND tc.element = 'project_task'";

$resql = $db->query($sql);
if ($resql) {
    if ($db->num_rows($resql)) {
        while ($obj = $db->fetch_object($resql)) {
            echo "Contact ID: " . $obj->fk_socpeople . "\n";
            echo "   Role: " . $obj->libelle . " (" . $obj->code . ")\n";
            echo "   Name: " . $obj->firstname . " " . $obj->lastname . "\n";
            if ($obj->linked_user_id) {
                echo "   -> LINKED TO USER: " . $obj->linked_user_login . " (ID: " . $obj->linked_user_id . ")\n";
            } else {
                echo "   -> NOT LINKED to any system User.\n";
            }
            echo "------------------------------------------------\n";
        }
    } else {
        echo "No contacts/participants found for this task.\n";
    }
} else {
    echo "Error: " . $db->lasterror();
}
