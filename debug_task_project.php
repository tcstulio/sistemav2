<?php
require 'main.inc.php';

// Simulate the query from custom_sync.php
$sql = "SELECT t.rowid as id, t.ref, t.label, t.fk_projet as project_id, p.ref as project_ref, p.title as project_title";
$sql .= " FROM " . MAIN_DB_PREFIX . "projet_task t";
$sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "projet p ON t.fk_projet = p.rowid";
$sql .= " LIMIT 5";

$res = $db->query($sql);
if ($res) {
    echo "<h1>Debug Task Project Data</h1>";
    echo "<table border='1'><tr><th>Task ID</th><th>Task Ref</th><th>Project ID</th><th>Project Ref</th><th>Project Title</th></tr>";
    while ($obj = $db->fetch_object($res)) {
        echo "<tr>";
        echo "<td>" . $obj->id . "</td>";
        echo "<td>" . $obj->ref . "</td>";
        echo "<td>" . $obj->project_id . "</td>";
        echo "<td>" . $obj->project_ref . "</td>";
        echo "<td>" . $obj->project_title . "</td>";
        echo "</tr>";
    }
    echo "</table>";
} else {
    echo "Query failed: " . $db->lasterror();
}
?>