<?php
require './main.inc.php';

// Set header for JSON response
header('Content-Type: application/json');

global $db;

$response = array();

// 1. Check Table Existence and Count
$sql = "SELECT COUNT(*) as count FROM " . MAIN_DB_PREFIX . "usergroup_user";
$resql = $db->query($sql);
if ($resql) {
    $obj = $db->fetch_object($resql);
    $response['total_records'] = $obj->count;
} else {
    $response['error_count'] = $db->lasterror();
}

// 2. Fetch Sample Data
$sql = "SELECT rowid, fk_user, fk_usergroup FROM " . MAIN_DB_PREFIX . "usergroup_user LIMIT 5";
$resql = $db->query($sql);
if ($resql) {
    $data = array();
    while ($obj = $db->fetch_object($resql)) {
        $data[] = $obj;
    }
    $response['sample_data'] = $data;
} else {
    $response['error_sample'] = $db->lasterror();
}

// 3. Test Custom Sync Query Logic
$sql = "SELECT rowid as id, fk_user as user_id, fk_usergroup as group_id";
$sql .= " FROM " . MAIN_DB_PREFIX . "usergroup_user";
$sql .= " WHERE rowid > 0";
$resql = $db->query($sql);
if ($resql) {
    $data = array();
    $i = 0;
    while ($obj = $db->fetch_object($resql)) {
        if ($i < 5)
            $data[] = $obj; // Only keep first 5 for preview
        $i++;
    }
    $response['custom_sync_test_count'] = $i;
    $response['custom_sync_test_sample'] = $data;
} else {
    $response['error_custom_sync'] = $db->lasterror();
}

echo json_encode($response, JSON_PRETTY_PRINT);
?>