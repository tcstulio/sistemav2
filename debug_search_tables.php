<?php
require 'main.inc.php';

function listTables($db, $pattern)
{
    echo "Searching tables matching: " . $pattern . "\n";
    $sql = "SHOW TABLES LIKE '" . MAIN_DB_PREFIX . $pattern . "'";
    $res = $db->query($sql);
    if ($res) {
        while ($row = $db->fetch_row($res)) {
            echo $row[0] . "\n";
        }
    } else {
        echo "Error: " . $db->lasterror() . "\n";
    }
    echo "\n";
}

// Search for all comment related tables
listTables($db, '%comment%');
listTables($db, '%note%');
listTables($db, '%action%');
listTables($db, '%msg%');
listTables($db, '%chat%');
?>