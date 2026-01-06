<?php
require 'main.inc.php';

// Search for specific system events that might be cluttering the chat
$keywords = ['senha', 'password', 'user', 'usuário', 'modifi'];

echo "Searching for Event Codes with keywords: " . implode(', ', $keywords) . "\n";
echo "--------------------------------------------------------\n";

$sql = "SELECT DISTINCT code, label FROM " . MAIN_DB_PREFIX . "actioncomm WHERE ";
$conditions = [];
foreach ($keywords as $k) {
    $conditions[] = "label LIKE '%" . $db->escape($k) . "%'";
}
$sql .= implode(' OR ', $conditions);
$sql .= " ORDER BY code ASC";

$res = $db->query($sql);

if ($res) {
    while ($obj = $db->fetch_object($res)) {
        echo "Code: [" . $obj->code . "] - Label: " . $obj->label . "\n";
    }
} else {
    echo "Error: " . $db->lasterror();
}
?>