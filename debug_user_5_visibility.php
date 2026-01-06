<?php
// debug_user_5_visibility.php
// Debugging visibility for User 5 (Mars)

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

$target_user_id = 5; // User 5

echo "Starting Debug for User $target_user_id...\n";

// 1. User Info
echo "\n--- User Info ---\n";
$sql = "SELECT rowid, login, email, fk_socpeople FROM " . MAIN_DB_PREFIX . "user WHERE rowid = " . $target_user_id;
$resql = $db->query($sql);
$user_data = null;
if ($resql) {
    $user_data = $db->fetch_object($resql);
    if ($user_data) {
        echo "Found User: " . $user_data->login . " (linked contact: " . ($user_data->fk_socpeople ? $user_data->fk_socpeople : 'None') . ")\n";
    } else {
        echo "User not found.\n";
    }
} else {
    echo "Query Failed: " . $db->lasterror() . "\n";
}

if (!$user_data)
    die("Cannot proceed without user.");
$linked_contact_id = $user_data->fk_socpeople;

// 2. Assigned Tasks
echo "\n--- Tasks Assigned to User ---\n";
$sql = "SELECT rowid, ref as task_ref, label FROM " . MAIN_DB_PREFIX . "projet_task WHERE fk_user_assign = " . $target_user_id;
$res = $db->query($sql);
$found = false;
if ($res) {
    while ($obj = $db->fetch_object($res)) {
        echo " - [Assigned] " . $obj->task_ref . ": " . $obj->label . "\n";
        $found = true;
    }
}
if (!$found)
    echo "No direct assignments found.\n";

// 3. Participant Tasks
echo "\n--- Tasks Participation (Direct) ---\n";
$limit_clause = " (tc.source = 'internal' AND c.fk_socpeople = $target_user_id) ";
if ($linked_contact_id) {
    $limit_clause .= " OR (tc.source = 'external' AND c.fk_socpeople = $linked_contact_id) ";
}
$sql = "SELECT t.rowid, t.ref, t.label, t.fk_statut, tc.source, c.fk_socpeople FROM " . MAIN_DB_PREFIX . "element_contact c 
        JOIN " . MAIN_DB_PREFIX . "c_type_contact tc ON c.fk_c_type_contact = tc.rowid 
        JOIN " . MAIN_DB_PREFIX . "projet_task t ON c.element_id = t.rowid 
        WHERE tc.element = 'project_task' AND ($limit_clause)";

$res = $db->query($sql);
$found = false;
if ($res) {
    while ($obj = $db->fetch_object($res)) {
        echo " - [Participant] ID: " . $obj->rowid . " | " . $obj->ref . ": " . $obj->label . " (Status: " . $obj->fk_statut . ", Source: " . $obj->source . ")\n";
        $found = true;
    }
}
if (!$found)
    echo "No direct participation found.\n";


// 4. Team View (Subordinates)
echo "\n--- Team View (Subordinates) ---\n";
// Find direct and indirect reports
$subordinate_ids = [];
$queue = [$target_user_id];
$processed = [];

// Safety limit
$loop_limit = 1000;
$i = 0;

echo "Calculating hierarchy...\n";

while (!empty($queue) && $i < $loop_limit) {
    $current_id = array_shift($queue);

    if (in_array($current_id, $processed))
        continue;
    $processed[] = $current_id;
    $i++;

    // Find direct reports of current_id
    // Note: In llx_user, 'fk_user' is the supervisor/parent. So we look for users WHERE fk_user = current_id
    $sql_subs = "SELECT rowid, login FROM " . MAIN_DB_PREFIX . "user WHERE fk_user = " . $current_id . " AND statut = 1";
    $res_subs = $db->query($sql_subs);
    if ($res_subs) {
        while ($sub = $db->fetch_object($res_subs)) {
            if (!in_array($sub->rowid, $subordinate_ids) && !in_array($sub->rowid, $processed) && !in_array($sub->rowid, $queue)) {
                $subordinate_ids[] = $sub->rowid;
                $queue[] = $sub->rowid;
            }
        }
    }
}

echo "Found " . count($subordinate_ids) . " subordinates.\n";
if (count($subordinate_ids) < 10) {
    echo "IDs: " . implode(", ", $subordinate_ids) . "\n";
} else {
    echo "IDs (first 10): " . implode(", ", array_slice($subordinate_ids, 0, 10)) . "...\n";
}

if (!empty($subordinate_ids)) {
    $ids_str = implode(',', $subordinate_ids);

    // A. Tasks ASSIGNED to Team
    echo "\n[Team - Assigned Tasks]\n";
    $sql = "SELECT rowid, ref, label, fk_user_assign FROM " . MAIN_DB_PREFIX . "projet_task WHERE fk_user_assign IN ($ids_str) LIMIT 20";
    $res = $db->query($sql);
    $found_team = false;
    if ($res && $db->num_rows($res) > 0) {
        while ($obj = $db->fetch_object($res)) {
            echo " - [Team-Assigned] " . $obj->ref . " (Assigned to User " . $obj->fk_user_assign . ")\n";
            $found_team = true;
        }
    } else {
        echo "No tasks directly assigned to team members.\n";
    }

    // B. Tasks Team PARTICIPATES in
    echo "\n[Team - Participation Tasks]\n";
    // Check internal contact links for these user IDs
    $sql = "SELECT DISTINCT t.rowid, t.ref, t.label, c.fk_socpeople, u.login as user_name 
            FROM " . MAIN_DB_PREFIX . "element_contact c 
            JOIN " . MAIN_DB_PREFIX . "c_type_contact tc ON c.fk_c_type_contact = tc.rowid 
            JOIN " . MAIN_DB_PREFIX . "projet_task t ON c.element_id = t.rowid 
            LEFT JOIN " . MAIN_DB_PREFIX . "user u ON c.fk_socpeople = u.rowid
            WHERE tc.element = 'project_task' 
            AND tc.source = 'internal' 
            AND c.fk_socpeople IN ($ids_str)
            LIMIT 20";

    $res = $db->query($sql);
    if ($res && $db->num_rows($res) > 0) {
        while ($obj = $db->fetch_object($res)) {
            echo " - [Team-Participant] " . $obj->ref . " (Partic: " . $obj->user_name . ")\n";
            $found_team = true;
        }
    } else {
        echo "No tasks found where team members are participants.\n";
    }
}

if (!$found)
    echo "No participation found.\n";

echo "\n--- Script Completed ---\n";
