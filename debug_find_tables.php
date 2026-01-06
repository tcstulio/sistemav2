<?php
require_once 'main.inc.php';
$sql = "SHOW TABLES LIKE '%task%'";
$res = $db->query($sql);
echo "Tables matching %task%:\n";
while ($row = $db->fetch_row($res)) {
    echo $row[0] . "\n";
}
$sql = "SHOW TABLES LIKE '%time%'";
$res = $db->query($sql);
echo "\nTables matching %time%:\n";
while ($row = $db->fetch_row($res)) {
    echo $row[0] . "\n";
}
