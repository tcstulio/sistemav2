<?php
require_once 'main.inc.php';

$supervisor_id = 5;

$sql = "SELECT rowid, login, firstname, lastname, fk_user, job FROM " . MAIN_DB_PREFIX . "user WHERE fk_user = " . $supervisor_id;
$res = $db->query($sql);

if ($res) {
    if ($db->num_rows($res) > 0) {
        echo "Users reporting to ID $supervisor_id:\n";
        while ($obj = $db->fetch_object($res)) {
            echo "- [ID: " . $obj->rowid . "] " . $obj->firstname . " " . $obj->lastname . " (" . $obj->login . ") - Job: " . $obj->job . "\n";
        }
    } else {
        echo "No users found reporting to ID $supervisor_id.\n";
    }
} else {
    echo "Error: " . $db->lasterror();
}
