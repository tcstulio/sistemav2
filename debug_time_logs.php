<?php
require_once 'main.inc.php';

// Check which table we are querying. custom_sync says 'element_time' with 'fk_element'.
$sql = "SELECT 
            t.rowid as id,
            t.fk_element as task_id,
            UNIX_TIMESTAMP(t.element_date) as date,
            UNIX_TIMESTAMP(t.element_datehour) as date_start,
            t.element_duration as duration,
            t.fk_user as user_id,
            t.note,
            UNIX_TIMESTAMP(t.tms) as tms
        FROM " . MAIN_DB_PREFIX . "element_time as t
        WHERE t.elementtype = 'task'
        ORDER BY t.tms DESC
        LIMIT 10";

$res = $db->query($sql);
if ($res) {
    echo "Found " . $db->num_rows($res) . " logs.\n";
    if ($db->num_rows($res) > 0) {
        while ($obj = $db->fetch_object($res)) {
            print_r($obj);
        }
    } else {
        echo "No logs found in element_time for tasks.\n";
    }
} else {
    echo "Error: " . $db->lasterror();
}
?>