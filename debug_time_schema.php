<?php
require_once 'main.inc.php';

function inspectTable($db, $tableName)
{
    echo "------------------------------------------------\n";
    echo "SCHEMA FOR: " . $tableName . "\n";
    echo "------------------------------------------------\n";
    $sql = "DESCRIBE " . MAIN_DB_PREFIX . $tableName;
    $res = $db->query($sql);
    if ($res) {
        while ($row = $db->fetch_object($res)) {
            echo str_pad($row->Field, 25) . " | " . str_pad($row->Type, 15) . "\n";
        }
    } else {
        echo "Table not found or error: " . $db->lasterror() . "\n";
    }
    echo "\n";
}

// 1. Find potential time tables
echo "SEARCHING FOR TIME-RELATED TABLES:\n";
$sql = "SHOW TABLES LIKE '%time%'";
$res = $db->query($sql);
while ($row = $db->fetch_row($res)) {
    echo "- " . $row[0] . "\n";
}
echo "\n";

// 2. Inspect key tables
inspectTable($db, 'element_time');      // Modern time tracking
inspectTable($db, 'projet_task_time');  // Legacy time tracking
inspectTable($db, 'projet_task');       // Task definitions
inspectTable($db, 'actioncomm');        // Events/Calendar

// 3. Inspect Data in element_time (first 5 rows) to see format
echo "------------------------------------------------\n";
echo "SAMPLE DATA: element_time\n";
echo "------------------------------------------------\n";
$sql = "SELECT * FROM " . MAIN_DB_PREFIX . "element_time LIMIT 5";
$res = $db->query($sql);
if ($res) {
    while ($obj = $db->fetch_object($res)) {
        print_r($obj);
    }
}
?>