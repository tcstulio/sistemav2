<?php
require 'main.inc.php';

function inspectTable($db, $tableName)
{
    echo "Table: " . $tableName . "\n";
    $sql = "DESCRIBE " . MAIN_DB_PREFIX . $tableName;
    $res = $db->query($sql);
    if ($res) {
        while ($row = $db->fetch_array($res)) {
            echo $row['Field'] . " (" . $row['Type'] . ")\n";
        }
    } else {
        echo "Error: " . $db->lasterror() . "\n";
    }
    echo "\n";
}

inspectTable($db, 'fichinter');
inspectTable($db, 'fichinterdet');
?>