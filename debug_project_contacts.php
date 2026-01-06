<?php
// Debug script for project contacts
// Include Dolibarr main manually to avoid custom_sync execution
// require_once './custom_sync.php';

// Mock DB connection if needed or just use the logic from custom_sync
// Since custom_sync.php is a script that executes immediately based on GET params, 
// we might need to modify it or just copy the logic here.
// Actually, I can just include main.inc.php and run the query manually.

if (!defined('NOTOKENRENEWAL'))
    define('NOTOKENRENEWAL', 1);
if (!defined("NOLOGIN"))
    define("NOLOGIN", 1);
if (!defined("NOCSRFCHECK"))
    define("NOCSRFCHECK", 1);
if (!defined('NOBROWSERNOTIF'))
    define('NOBROWSERNOTIF', 1);

// Load Dolibarr environment
$res = 0;
if (!$res && file_exists("main.inc.php"))
    $res = @include 'main.inc.php'; // Check current dir first
if (!$res && file_exists("../main.inc.php"))
    $res = @include '../main.inc.php';
if (!$res && file_exists("../../main.inc.php"))
    $res = @include '../../main.inc.php';
if (!$res && file_exists("../../../main.inc.php"))
    $res = @include '../../../main.inc.php';

if (!$res)
    die("Include main fail");

header('Content-Type: text/plain');

$userId = 5; // tulio.silva

echo "Debugging Project Contacts for User ID: $userId\n\n";

// 1. Fetch Project Contacts
// Column c.fk_user DOES NOT EXIST in this schema. We must link via fk_socpeople.
$sql = "SELECT c.rowid as id, c.element_id as project_id, c.fk_socpeople as contact_id, u.rowid as user_id, c.fk_c_type_contact as type_id";
$sql .= " FROM " . MAIN_DB_PREFIX . "element_contact c";
$sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "user u ON c.fk_socpeople = u.fk_socpeople"; // Try to find user via contact link
$sql .= " INNER JOIN " . MAIN_DB_PREFIX . "c_type_contact tc ON c.fk_c_type_contact = tc.rowid";
$sql .= " INNER JOIN " . MAIN_DB_PREFIX . "projet p ON c.element_id = p.rowid";
$sql .= " WHERE tc.element = 'project'";
// Link via user's linked contact if possible
$sql .= " AND (u.rowid = " . $userId . " OR c.fk_socpeople IN (SELECT fk_socpeople FROM " . MAIN_DB_PREFIX . "user WHERE rowid = " . $userId . "))";
$sql .= " LIMIT 100";

echo "Query: $sql\n\n";

$resql = $db->query($sql);
if ($resql) {
    if ($db->num_rows($resql)) {
        echo "Found " . $db->num_rows($resql) . " project contacts:\n";
        while ($obj = $db->fetch_object($resql)) {
            echo " - Project: " . $obj->project_id . ", User: " . $obj->user_id . ", Contact: " . $obj->contact_id . "\n";
        }
    } else {
        echo "No project contacts found.\n";
    }
} else {
    echo "Error: " . $db->lasterror() . "\n";
}

echo "\n------------------------------------------------\n\n";

// 2. Fetch Tasks for that User (to verify visibility logic)
$sqlTasks = "SELECT t.rowid as id, t.label, t.fk_user_valid, t.fk_projet";
$sqlTasks .= " FROM " . MAIN_DB_PREFIX . "projet_task t";
$sqlTasks .= " LEFT JOIN " . MAIN_DB_PREFIX . "element_contact ec ON ec.element_id = t.rowid";
$sqlTasks .= " LEFT JOIN " . MAIN_DB_PREFIX . "c_type_contact ctc ON ec.fk_c_type_contact = ctc.rowid AND ctc.element = 'project_task'";
$sqlTasks .= " LEFT JOIN " . MAIN_DB_PREFIX . "user u_contact ON ec.fk_socpeople = u_contact.fk_socpeople";
// Check project links too... this query gets complex to simulate exactly.
// Simplified: Just check if we can find tasks where he is assigned OR (linked via contact to task) OR (linked via contact to project)

// Subquery for user's contact ID
$subContact = "(SELECT fk_socpeople FROM " . MAIN_DB_PREFIX . "user WHERE rowid = " . $userId . ")";

$sqlTasks = "SELECT DISTINCT t.rowid as id, t.label, t.fk_user_valid, t.fk_projet";
$sqlTasks .= " FROM " . MAIN_DB_PREFIX . "projet_task t";
$sqlTasks .= " WHERE t.fk_user_valid = " . $userId;
$sqlTasks .= " OR t.rowid IN (SELECT element_id FROM " . MAIN_DB_PREFIX . "element_contact WHERE fk_socpeople = " . $subContact . " AND fk_c_type_contact IN (SELECT rowid FROM " . MAIN_DB_PREFIX . "c_type_contact WHERE element = 'project_task'))";
$sqlTasks .= " OR t.fk_projet IN (SELECT element_id FROM " . MAIN_DB_PREFIX . "element_contact WHERE fk_socpeople = " . $subContact . " AND fk_c_type_contact IN (SELECT rowid FROM " . MAIN_DB_PREFIX . "c_type_contact WHERE element = 'project'))";
$sqlTasks .= " LIMIT 20";

echo "Checking explicit tasks visibility (SQL Simulation):\n";
echo "Query: $sqlTasks\n\n";

$resTasks = $db->query($sqlTasks);
if ($resTasks) {
    if ($db->num_rows($resTasks)) {
        echo "Found " . $db->num_rows($resTasks) . " visible tasks:\n";
        while ($task = $db->fetch_object($resTasks)) {
            echo " - Task: " . $task->id . " (" . $task->label . "), Assignee: " . $task->fk_user_valid . ", Project: " . $task->fk_projet . "\n";
        }
    } else {
        echo "No visible tasks found for user $userId via direct SQL check.\n";
    }
}

