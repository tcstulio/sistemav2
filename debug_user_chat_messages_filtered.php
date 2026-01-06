<?php
require 'main.inc.php';

$userId = 5;

echo "Simulating Chat Message Sync for User ID: $userId\n";
echo "--------------------------------------------------\n";

// Filters from custom_sync.php
$filters = " AND (a.code IS NULL OR (a.code NOT LIKE '%_AUTO' AND a.code NOT LIKE '%_MODIFY' AND a.code NOT LIKE '%_CREATE' AND a.code NOT LIKE '%_DELETE' AND a.code NOT LIKE '%_VALIDATE' AND a.code NOT LIKE '%_PAYED' AND a.code NOT LIKE '%_PAID' AND a.code NOT LIKE '%_APPROVE' AND a.code NOT LIKE '%_UNVALIDATE' AND a.code NOT LIKE '%_CLOSE%' AND a.code NOT LIKE '%_SENTBYMAIL' AND a.code NOT LIKE '%_SUBMIT' AND a.code NOT LIKE '%_RECEIVE' AND a.code NOT LIKE '%_CLASSIFY%' AND a.code NOT LIKE '%_ENABLEDISABLE' AND a.code NOT LIKE '%_CANCEL' AND a.code NOT LIKE 'TICKET_MSG%' AND a.code != 'AC_USER_NEW_PASSWORD'))";

$sql = "SELECT 
            a.id, 
            a.label, 
            a.note, 
            a.code,
            a.fk_user_author, 
            u.firstname as author_name,
            a.elementtype, 
            a.fk_element,
            a.datep as date
        FROM " . MAIN_DB_PREFIX . "actioncomm a
        LEFT JOIN " . MAIN_DB_PREFIX . "user u ON a.fk_user_author = u.rowid
        WHERE 
           ((a.fk_user_author = " . $userId . " AND a.elementtype = 'user') 
           OR 
           (a.fk_element = " . $userId . " AND a.elementtype = 'user'))
           " . $filters . "
        ORDER BY a.datep DESC
        LIMIT 50";

$res = $db->query($sql);

if ($res) {
    $num = $db->num_rows($res);
    echo "Found $num RELEVANT messages after filtering:\n\n";
    while ($obj = $db->fetch_object($res)) {
        $direction = ($obj->fk_user_author == $userId) ? "SENT -> User ID " . $obj->fk_element : "RECEIVED <- From User ID " . $obj->fk_user_author . " (" . $obj->author_name . ")";

        $noteSample = strip_tags($obj->note);
        if (empty($noteSample))
            $noteSample = $obj->label;

        echo "ID: " . $obj->id . " | Code: " . $obj->code . " | Date: " . $obj->date . "\n";
        echo "Direction: " . $direction . "\n";
        echo "Content: " . $noteSample . "\n";
        echo "--------------------------------------------------\n";
    }
} else {
    echo "Error: " . $db->lasterror();
}
?>