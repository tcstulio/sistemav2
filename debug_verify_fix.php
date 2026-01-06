<?php
// Debug: Verify Project Contacts/Tasks Sync Logic
// This script replicates the LOGIC used in custom_sync.php (after the fix)
// to verify it correctly finds identifying information.

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

$targetTaskId = 689;

echo "--- VERIFYING LOGIC FOR TASK $targetTaskId ---\n\n";

// Replicating the logic from custom_sync.php 'task_contacts' case
// We filter by element_id directly here for testing
$sql = "SELECT c.rowid as id, c.element_id as task_id, c.fk_c_type_contact as type_id,";
$sql .= " CASE WHEN tc.source = 'internal' THEN c.fk_socpeople ELSE u_linked.rowid END as user_id,";
$sql .= " CASE WHEN tc.source = 'external' THEN c.fk_socpeople ELSE u_internal.fk_socpeople END as contact_id,";
$sql .= " tc.source, tc.code";
$sql .= " FROM " . MAIN_DB_PREFIX . "element_contact c";
$sql .= " INNER JOIN " . MAIN_DB_PREFIX . "c_type_contact tc ON c.fk_c_type_contact = tc.rowid";
$sql .= " INNER JOIN " . MAIN_DB_PREFIX . "projet_task t ON c.element_id = t.rowid";
// Join for Internal Source (c.fk_socpeople = user_id)
$sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "user u_internal ON (tc.source = 'internal' AND c.fk_socpeople = u_internal.rowid)";
// Join for External Source (c.fk_socpeople = contact_id -> linked to user)
$sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "user u_linked ON (tc.source = 'external' AND c.fk_socpeople = u_linked.fk_socpeople)";
$sql .= " WHERE c.element_id = " . $targetTaskId;

$resql = $db->query($sql);
if ($resql) {
    if ($db->num_rows($resql)) {
        while ($obj = $db->fetch_object($resql)) {
            echo "Contact RowID: " . $obj->id . "\n";
            echo "Type Source: " . $obj->source . " (" . $obj->code . ")\n";
            echo "Raw fk_socpeople: " . $obj->user_id . " (if internal) or " . $obj->contact_id . " (if external)\n";
            echo "Resolved USER_ID: " . ($obj->user_id ? $obj->user_id : "NULL") . "\n";
            echo "Resolved CONTACT_ID: " . ($obj->contact_id ? $obj->contact_id : "NULL") . "\n";

            if ($obj->user_id) {
                // Fetch User Name to confirm
                $u = new User($db);
                $u->fetch($obj->user_id);
                echo "   -> User Name: " . $u->firstname . " " . $u->lastname . " (Login: " . $u->login . ")\n";
            }
            echo "------------------------------------------------\n";
        }
    } else {
        echo "No contacts found for Task $targetTaskId with this query.\n";
    }
} else {
    echo "SQL Error: " . $db->lasterror();
}
