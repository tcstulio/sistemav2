<?php
// debug_user_16_visibility.php
// Minimalist version matching the working example provided by user

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

echo "Starting Debug for User 16...\n";
if (!isset($db))
    echo "DB Object missing!\n";
else
    echo "DB Object present.\n";

$target_user_id = 16;

// 1. User Info
echo "\n--- User Info ---\n";
// Found 'fk_user' as supervisor_id in custom_sync.php line 276
$sql = "SELECT rowid, login, email, fk_socpeople, fk_user FROM " . MAIN_DB_PREFIX . "user WHERE rowid = " . $target_user_id;
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

// 2. Subordinates
echo "\n--- Subordinates ---\n";
$queue = [$target_user_id];
$all_subs = [];
// Safe BFS
$max_loops = 100;
$loops = 0;
while (!empty($queue) && $loops < $max_loops) {
    $loops++;
    $current = array_shift($queue);
    // Corrected to use 'fk_user' as hierarchy parent
    $sql_sub = "SELECT rowid, login FROM " . MAIN_DB_PREFIX . "user WHERE fk_user = " . $current;
    $res_sub = $db->query($sql_sub);
    while ($sub = $db->fetch_object($res_sub)) {
        if (!in_array($sub->rowid, $all_subs)) {
            echo " - Subordinate found: " . $sub->login . " (ID: " . $sub->rowid . ")\n";
            $all_subs[] = $sub->rowid;
            $queue[] = $sub->rowid;
        }
    }
}
$team_ids = $all_subs;

// 3. Assigned Tasks
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

// 4. Participant Tasks
echo "\n--- Tasks Participation ---\n";
$limit_clause = " (tc.source = 'internal' AND c.fk_socpeople = $target_user_id) ";
if ($linked_contact_id) {
    $limit_clause .= " OR (tc.source = 'external' AND c.fk_socpeople = $linked_contact_id) ";
}
$sql = "SELECT t.ref, t.label FROM " . MAIN_DB_PREFIX . "element_contact c 
        JOIN " . MAIN_DB_PREFIX . "c_type_contact tc ON c.fk_c_type_contact = tc.rowid 
        JOIN " . MAIN_DB_PREFIX . "projet_task t ON c.element_id = t.rowid 
        WHERE tc.element = 'project_task' AND ($limit_clause)";
$res = $db->query($sql);
$found = false;
if ($res) {
    while ($obj = $db->fetch_object($res)) {
        echo " - [Participant] " . $obj->ref . ": " . $obj->label . "\n";
        $found = true;
    }
} else {
    echo "Query Error: " . $db->lasterror() . "\n";
}
if (!$found)
    echo "No participation found.\n";

// 5. Team Tasks
echo "\n--- Team Visible Tasks ---\n";
// Increase time limit for checking large team
set_time_limit(300);

if (!empty($team_ids)) {
    echo "Checking tasks for " . count($team_ids) . " subordinates...\n";
    $team_list = implode(',', $team_ids);

    // Assigned
    $sql = "SELECT t.ref, t.label, u.login FROM " . MAIN_DB_PREFIX . "projet_task t 
            JOIN " . MAIN_DB_PREFIX . "user u ON t.fk_user_assign = u.rowid 
            WHERE t.fk_user_assign IN ($team_list)";
    $res = $db->query($sql);
    $found = false;
    if ($res) {
        while ($obj = $db->fetch_object($res)) {
            echo " - [Team Assigned] " . $obj->ref . " (Assigned to " . $obj->login . ")\n";
            $found = true;
        }
    }
    if (!$found)
        echo "No tasks assigned to team members found.\n";

    // Team is Participant
    echo "\n--- Team Participation (Tasks where team members are contacts) ---\n";
    $sql = "SELECT t.ref, t.label, c.fk_socpeople as user_id_in_contact, u.login as user_login 
            FROM " . MAIN_DB_PREFIX . "element_contact c 
            JOIN " . MAIN_DB_PREFIX . "c_type_contact tc ON c.fk_c_type_contact = tc.rowid 
            JOIN " . MAIN_DB_PREFIX . "projet_task t ON c.element_id = t.rowid 
            LEFT JOIN " . MAIN_DB_PREFIX . "user u ON c.fk_socpeople = u.rowid 
            WHERE tc.element = 'project_task' 
            AND tc.source = 'internal' 
            AND c.fk_socpeople IN ($team_list)";

    $res = $db->query($sql);
    $found_part = false;
    if ($res) {
        while ($obj = $db->fetch_object($res)) {
            echo " - [Team Participant] " . $obj->ref . " (User: " . $obj->user_login . ")\n";
            $found_part = true;
        }
    }
    if (!$found_part)
        echo "No tasks with team participation found.\n";
} else {
    echo "No team members found.\n";
}

echo "\n--- Script Completed Successfully ---\n";
