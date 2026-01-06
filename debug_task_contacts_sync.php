<?php
// debug_task_contacts_sync.php
// Replicates the exact query from custom_sync.php to find why it returns 0 results

define('NOT_CHECK_PERMISSIONS', true);
define('cal_disable_auto_load', true);
define('NOSTYLECHECK', 1);

if (!defined('NOCSRFCHECK'))
    define('NOCSRFCHECK', 1);

$res = 0;
if (!$res && file_exists("../main.inc.php"))
    $res = @include '../main.inc.php';
if (!$res && file_exists("../../main.inc.php"))
    $res = @include '../../main.inc.php';
if (!$res && file_exists("../../../main.inc.php"))
    $res = @include '../../../main.inc.php';
if (!$res && file_exists("main.inc.php"))
    $res = @include 'main.inc.php';
if (!$res)
    die("Include main fail");

header('Content-Type: text/plain');

echo "--- Debugging custom_sync.php 'task_contacts' Logic ---\n";

$last_modified = 0; // Simulate full sync

$sql = "SELECT c.rowid as id, c.element_id as task_id, c.fk_c_type_contact as type_id,";
$sql .= " CASE WHEN tc.source = 'internal' THEN c.fk_socpeople ELSE u_linked.rowid END as user_id,";
// Fixed possible typo in custom_sync? Let's check what was there.
// Copied from cache: CASE WHEN tc.source = 'external' THEN c.fk_socpeople ELSE u_internal.fk_socpeople END as contact_id
$sql .= " CASE WHEN tc.source = 'external' THEN c.fk_socpeople ELSE u_internal.fk_socpeople END as contact_id";
$sql .= " FROM " . MAIN_DB_PREFIX . "element_contact c";
$sql .= " INNER JOIN " . MAIN_DB_PREFIX . "c_type_contact tc ON c.fk_c_type_contact = tc.rowid";
$sql .= " INNER JOIN " . MAIN_DB_PREFIX . "projet_task t ON c.element_id = t.rowid";
$sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "user u_internal ON (tc.source = 'internal' AND c.fk_socpeople = u_internal.rowid)";
$sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "user u_linked ON (tc.source = 'external' AND c.fk_socpeople = u_linked.fk_socpeople)";
$sql .= " WHERE tc.element = 'project_task'";
$sql .= " AND t.tms >= '" . $db->idate($last_modified) . "'";
// Adding Limits as per sync
$sql .= " LIMIT 100";

echo "SQL Used:\n$sql\n\n";

$res = $db->query($sql);
if ($res) {
    $num = $db->num_rows($res);
    echo "Rows returned: $num\n";
    if ($num > 0) {
        $i = 0;
        while ($obj = $db->fetch_object($res)) {
            echo "[$i] ID: " . $obj->id . " | Task: " . $obj->task_id . " | User: " . $obj->user_id . " | Contact: " . $obj->contact_id . "\n";
            $i++;
            if ($i >= 20)
                break;
        }
    }
} else {
    echo "Query Failed: " . $db->lasterror() . "\n";
}

// Check if maybe table alias 't' is ambiguous? No.

echo "\n--- Comparison with Simple Query ---\n";
// Simple query to verify data exists at all
$sql_simple = "SELECT count(*) as cnt FROM " . MAIN_DB_PREFIX . "element_contact c 
              JOIN " . MAIN_DB_PREFIX . "c_type_contact tc ON c.fk_c_type_contact = tc.rowid 
              WHERE tc.element = 'project_task'";
$res_simple = $db->query($sql_simple);
if ($res_simple) {
    $obj = $db->fetch_object($res_simple);
    echo "Total entries in element_contact for 'project_task': " . $obj->cnt . "\n";
}
