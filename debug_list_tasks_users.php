<?php
// Debug: List Tasks and their Users
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

echo "--- TASKS WITH ASSIGNED USERS (fk_user_valid) ---\n";
$sql = "SELECT t.rowid as task_id, t.label, t.fk_user_valid, u.login, u.firstname, u.lastname, p.title as project_title";
$sql .= " FROM " . MAIN_DB_PREFIX . "projet_task t";
$sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "user u ON t.fk_user_valid = u.rowid";
$sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "projet p ON t.fk_projet = p.rowid";
$sql .= " WHERE t.fk_user_valid IS NOT NULL AND t.fk_user_valid > 0";
$sql .= " ORDER BY t.rowid DESC LIMIT 50";

$resql = $db->query($sql);
if ($resql) {
    if ($db->num_rows($resql)) {
        while ($obj = $db->fetch_object($resql)) {
            echo "Task ID: " . $obj->task_id . " | Label: " . $obj->label . "\n";
            echo "   Project: " . $obj->project_title . "\n";
            echo "   Assigned To: " . $obj->firstname . " " . $obj->lastname . " (ID: " . $obj->fk_user_valid . ")\n";
            echo "------------------------------------------------\n";
        }
    } else {
        echo "No tasks found with direct assignments.\n";
    }
} else {
    echo "Error: " . $db->lasterror() . "\n";
}

echo "\n\n--- TASKS WITH PARTICIPANTS (Contacts) ---\n";
$sql = "SELECT t.rowid as task_id, t.label, ec.fk_socpeople, u.rowid as user_id, u.firstname, u.lastname";
$sql .= " FROM " . MAIN_DB_PREFIX . "element_contact ec";
$sql .= " INNER JOIN " . MAIN_DB_PREFIX . "c_type_contact tc ON ec.fk_c_type_contact = tc.rowid";
$sql .= " INNER JOIN " . MAIN_DB_PREFIX . "projet_task t ON ec.element_id = t.rowid";
$sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "user u ON ec.fk_socpeople = u.fk_socpeople";
$sql .= " WHERE tc.element = 'project_task'";
$sql .= " ORDER BY t.rowid DESC LIMIT 50";

$resql = $db->query($sql);
if ($resql) {
    if ($db->num_rows($resql)) {
        while ($obj = $db->fetch_object($resql)) {
            echo "Task ID: " . $obj->task_id . " | Label: " . $obj->label . "\n";
            echo "   Participant Contact ID: " . $obj->fk_socpeople . "\n";
            if ($obj->user_id) {
                echo "   Linked User: " . $obj->firstname . " " . $obj->lastname . " (ID: " . $obj->user_id . ")\n";
            } else {
                echo "   (No linked User found for this contact)\n";
            }
            echo "------------------------------------------------\n";
        }
    } else {
        echo "No tasks found with participant contacts.\n";
    }
} else {
    echo "Error: " . $db->lasterror() . "\n";
}

echo "\n\n--- USERS WITH MOST TASKS ---\n";
$sql = "SELECT u.rowid, u.firstname, u.lastname, COUNT(t.rowid) as task_count";
$sql .= " FROM " . MAIN_DB_PREFIX . "user u";
$sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "projet_task t ON t.fk_user_valid = u.rowid";
$sql .= " GROUP BY u.rowid, u.firstname, u.lastname";
$sql .= " HAVING task_count > 0";
$sql .= " ORDER BY task_count DESC LIMIT 10";

$resql = $db->query($sql);
if ($resql) {
    while ($obj = $db->fetch_object($resql)) {
        echo "User: " . $obj->firstname . " " . $obj->lastname . " (ID: " . $obj->rowid . ") - Tasks: " . $obj->task_count . "\n";
    }
}
