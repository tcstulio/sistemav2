<?php
// Create Test Task for User 5
$res = 0;
if (!$res && file_exists("main.inc.php"))
    $res = @include 'main.inc.php';
if (!$res && file_exists("../main.inc.php"))
    $res = @include '../main.inc.php';
if (!$res && file_exists("../../main.inc.php"))
    $res = @include '../../main.inc.php';

if (!$res)
    die("Include main fail");

require_once DOL_DOCUMENT_ROOT . '/projet/class/task.class.php';
require_once DOL_DOCUMENT_ROOT . '/projet/class/project.class.php';

header('Content-Type: text/plain');

$userId = 5;
$userObject = new User($db);
$userObject->fetch($userId);

if (!$userObject->id) {
    die("User 5 not found");
}

echo "Acting as User 5: " . $userObject->firstname . "\n";

// 1. Check/Create Project
$project = new Project($db);
$sql = "SELECT rowid FROM " . MAIN_DB_PREFIX . "projet LIMIT 1";
$resql = $db->query($sql);
if ($resql && $obj = $db->fetch_object($resql)) {
    $project->fetch($obj->rowid);
    echo "Using existing project: " . $project->title . " (ID: " . $project->id . ")\n";
} else {
    echo "Creating new project...\n";
    $project->title = "Test Project for Visibility";
    $project->ref = "PROJ-TEST-VIS";
    $project->create($userObject);
    echo "Created project ID: " . $project->id . "\n";
}

// 2. Create Task Assigned to User 5
$task = new Task($db);
$task->label = "Test Task for User 5 Visibility";
$task->description = "This task was created to verify that User 5 can see assigned tasks.";
$task->fk_project = $project->id;
$task->fk_user_assign = $userObject->id; // Assign to User 5
$task->progress = 0;
$task->priority = 1;
$task->planned_workload = 3600;

$res = $task->create($userObject);

if ($res > 0) {
    echo "SUCCESS: Created Task ID " . $task->id . " assigned to User 5.\n";
    echo "Label: " . $task->label . "\n";
} else {
    echo "ERROR creating task: " . $task->error . "\n";
    print_r($task->errors);
}

// 3. List all tasks briefly
echo "\n--- Current Tasks in DB ---\n";
$sqlList = "SELECT rowid, label, fk_user_valid FROM " . MAIN_DB_PREFIX . "projet_task ORDER BY rowid DESC LIMIT 10";
$resList = $db->query($sqlList);
while ($t = $db->fetch_object($resList)) {
    echo "Task " . $t->rowid . ": " . $t->label . " | Assigned User ID: " . ($t->fk_user_valid ? $t->fk_user_valid : "None") . "\n";
}
