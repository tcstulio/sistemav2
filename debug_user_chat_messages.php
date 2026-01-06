<?php
require 'main.inc.php';

$userId = 5;

echo "Searching for chat messages for User ID: $userId\n";
echo "--------------------------------------------------\n";

// Query for messages SENT BY User 5 or SENT TO User 5 (where fk_element = 5 and elementtype = 'user')
$sql = "SELECT 
            a.id, 
            a.label, 
            a.note, 
            a.fk_user_author, 
            u.firstname as author_name,
            a.elementtype, 
            a.fk_element,
            a.datep as date
        FROM " . MAIN_DB_PREFIX . "actioncomm a
        LEFT JOIN " . MAIN_DB_PREFIX . "user u ON a.fk_user_author = u.rowid
        WHERE 
           (a.fk_user_author = " . $userId . " AND a.elementtype = 'user') 
           OR 
           (a.fk_element = " . $userId . " AND a.elementtype = 'user')
        ORDER BY a.datep DESC
        LIMIT 50";

$res = $db->query($sql);

if ($res) {
    $num = $db->num_rows($res);
    echo "Found $num messages:\n\n";
    while ($obj = $db->fetch_object($res)) {
        $direction = ($obj->fk_user_author == $userId) ? "SENT -> User ID " . $obj->fk_element : "RECEIVED <- From User ID " . $obj->fk_user_author . " (" . $obj->author_name . ")";

        // Clean up note for display
        $noteSample = strip_tags($obj->note);
        if (strlen($noteSample) > 50)
            $noteSample = substr($noteSample, 0, 50) . "...";
        if (empty($noteSample))
            $noteSample = $obj->label;

        echo "ID: " . $obj->id . " | Date: " . $obj->date . "\n";
        echo "Direction: " . $direction . "\n";
        echo "Content: " . $noteSample . "\n";
        echo "--------------------------------------------------\n";
    }
} else {
    echo "Error: " . $db->lasterror();
}
?>