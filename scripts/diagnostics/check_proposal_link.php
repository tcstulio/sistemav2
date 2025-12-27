<?php
/**
 * Diagnostic Script: Check Proposal Link
 * Usage: GET /check_proposal_link.php?DOLAPIKEY=...
 */

// 1. Load Dolibarr environment
if (!defined("NOCSRFCHECK"))
    define("NOCSRFCHECK", 1);
if (!defined("NOTOKENRENEWAL"))
    define("NOTOKENRENEWAL", 1);
if (!defined('NOREQUIREMENU'))
    define('NOREQUIREMENU', '1');
if (!defined('NOREQUIREHTML'))
    define('NOREQUIREHTML', '1');
if (!defined('NOREQUIREAJAX'))
    define('NOREQUIREAJAX', '1');
if (!defined('NOLOGIN'))
    define('NOLOGIN', '1');

// Adjust this path if your main.inc.php is elsewhere
require 'main.inc.php';

// --- Auth Check (Same as custom_sync.php) ---
$apikey = GETPOST('DOLAPIKEY', 'none');
if (empty($apikey)) {
    $headers = apache_request_headers();
    if (!empty($headers['DOLAPIKEY'])) {
        $apikey = $headers['DOLAPIKEY'];
    }
}
$apikey = trim($apikey);

if (empty($apikey)) {
    http_response_code(401);
    die("Missing API Key");
}

// Simple key check
$foundUser = false;
$sql_users = "SELECT rowid FROM " . MAIN_DB_PREFIX . "user WHERE statut = 1";
$res_users = $db->query($sql_users);
if ($res_users) {
    while ($u = $db->fetch_object($res_users)) {
        $tmp_user = new User($db);
        $tmp_user->fetch($u->rowid);
        if ($tmp_user->api_key === $apikey) {
            $foundUser = true;
            break;
        }
    }
}

if (!$foundUser) {
    http_response_code(401);
    die("Invalid API Key");
}
// ---------------------------------------------

$ref_to_check = "PR2510-0057";

echo "<h1>Diagnostic Report</h1>";
echo "<p>Checking Proposal: <strong>$ref_to_check</strong></p>";

echo "<h2>Test 1: Direct Table Join</h2>";
$sql = "SELECT p.rowid, p.ref, p.fk_projet, proj.ref as project_ref, proj.title as project_title";
$sql .= " FROM " . MAIN_DB_PREFIX . "propal p";
$sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "projet proj ON p.fk_projet = proj.rowid";
$sql .= " WHERE p.ref = '" . $db->escape($ref_to_check) . "'";

$res = $db->query($sql);
if ($res) {
    if ($db->num_rows($res) > 0) {
        $obj = $db->fetch_object($res);
        echo "<table border='1' cellpadding='5'>";
        foreach ($obj as $key => $val) {
            echo "<tr><td>$key</td><td>$val</td></tr>";
        }
        echo "</table>";

        echo "<br>";
        if (!empty($obj->fk_projet) && $obj->fk_projet > 0) {
            echo "<h3 style='color: green;'>✅ LINKED to Project (Direct Check)</h3>";
            echo "Project ID: " . $obj->fk_projet . "<br>";
            echo "Project Ref: " . $obj->project_ref . "<br>";
            echo "Project Title: " . $obj->project_title . "<br>";
        } else {
            echo "<h3 style='color: red;'>❌ NOT LINKED to any Project (Direct Check)</h3>";
            echo "fk_projet is empty or 0.";
        }
    } else {
        echo "<h3 style='color: orange;'>⚠️ Proposal Not Found</h3>";
    }
} else {
    echo "SQL Error: " . $db->lasterror();
}

echo "<hr>";
echo "<h2>Test 2: Simulation of custom_sync.php Query</h2>";
echo "<p>Running the EXACT query used by the sync script:</p>";

// This is the query from custom_sync.php line 114
$sql_sync = "SELECT rowid as id, ref, total_ht, total_ttc, total_tva, fk_statut as statut, fk_soc, fk_projet as project_id, fk_user_author, UNIX_TIMESTAMP(datec) as datec, UNIX_TIMESTAMP(tms) as tms FROM " . MAIN_DB_PREFIX . "propal WHERE ref = '" . $db->escape($ref_to_check) . "'";

echo "<pre style='background: #f0f0f0; padding: 10px;'>" . htmlspecialchars($sql_sync) . "</pre>";

$res_sync = $db->query($sql_sync);
if ($res_sync) {
    if ($db->num_rows($res_sync) > 0) {
        $obj_sync = $db->fetch_object($res_sync);
        echo "<h3>Result from Sync Logic:</h3>";

        // Debug output of the entire object
        echo "<pre>";
        print_r($obj_sync);
        echo "</pre>";

        // Check specifically for project_id
        if (isset($obj_sync->project_id)) {
            echo "<h2 style='color: green;'>✅ project_id field IS present: " . $obj_sync->project_id . "</h2>";
            echo "<p>This confirms the database can return the field using the alias.</p>";
        } else {
            echo "<h2 style='color: red;'>❌ project_id field is MISSING in result object!</h2>";
            echo "<p>This means the SQL executed correctly but the returned object does not have the property. This shouldn't happen unless the alias failed.</p>";
        }
    } else {
        echo "Object not found with sync query.";
    }
} else {
    echo "SQL Sync Error: " . $db->lasterror();
}
?>