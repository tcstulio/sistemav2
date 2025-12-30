<?php
// test_sync.php - Diagnostic Tool

// 1. Output as Text for easy reading in browser
header('Content-Type: text/plain');
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

echo "=== DIAGNOSTIC START ===\n";

// 2. Load Dolibarr
if (!defined("NOCSRFCHECK"))
    define("NOCSRFCHECK", 1);
if (!defined("NOTOKENRENEWAL"))
    define("NOTOKENRENEWAL", 1);
if (!defined('NOREQUIREMENU'))
    define('NOREQUIREMENU', '1');
if (!defined('NOREQUIREHTML'))
    define('NOREQUIREHTML', '1');
if (!defined('NOLOGIN'))
    define('NOLOGIN', '1');

echo "Loading main.inc.php... ";
if (file_exists('main.inc.php')) {
    require 'main.inc.php';
    echo "OK\n";
} else {
    die("FAIL: main.inc.php not found.\n");
}

// 3. Check Database
echo "Checking Database connection... ";
if ($db->ok) {
    echo "OK\n";
} else {
    die("FAIL: Database not connected. " . $db->lasterror() . "\n");
}

// 4. Check API Key Input
echo "--- AUTH CHECK ---\n";
$apikey_get = isset($_GET['DOLAPIKEY']) ? $_GET['DOLAPIKEY'] : '';
$apikey_header = '';
$headers = apache_request_headers();
if (!empty($headers['DOLAPIKEY'])) {
    $apikey_header = $headers['DOLAPIKEY'];
}

echo "API Key (GET): " . ($apikey_get ? (substr($apikey_get, 0, 5) . "...") : "NONE") . "\n";
echo "API Key (Header): " . ($apikey_header ? (substr($apikey_header, 0, 5) . "...") : "NONE") . "\n";

$apikey = $apikey_get ?: $apikey_header;

if (empty($apikey)) {
    echo "WARNING: No API Key provided. Test will proceed but Auth check will fail.\n";
}

// 5. Check User Auth
$foundUser = null;
if ($apikey) {
    $sql_users = "SELECT rowid FROM " . MAIN_DB_PREFIX . "user WHERE statut = 1";
    $res_users = $db->query($sql_users);
    if ($res_users) {
        while ($u = $db->fetch_object($res_users)) {
            $tmp_user = new User($db);
            $tmp_user->fetch($u->rowid);
            if ($tmp_user->api_key === $apikey) {
                $foundUser = $tmp_user;
                break;
            }
        }
    }
}

if ($foundUser) {
    echo "Auth Status: SUCCESS (User: " . $foundUser->login . ")\n";
} else {
    echo "Auth Status: FAILED (Invalid Key)\n";
}

// 6. Test Product Query (The potential crasher)
echo "--- QUERY CHECK (Products) ---\n";
$last_modified = 0;

// SAFE QUERY (No Stock)
$sql_safe = "SELECT rowid, ref, label FROM " . MAIN_DB_PREFIX . "product LIMIT 1";
echo "Testing Safe Query... ";
$res = $db->query($sql_safe);
if ($res) {
    echo "OK (" . $db->num_rows($res) . " rows)\n";
} else {
    echo "FAIL: " . $db->lasterror() . "\n";
}

// THE FIX QUERY (0 Stack)
$sql_fix = "SELECT p.rowid as id, p.ref, p.label, p.description, p.fk_product_type as type, p.price, p.price_ttc, p.tva_tx as vat_rate, ";
$sql_fix .= " 0 as stock, ";
$sql_fix .= " p.tosell, p.tobuy, p.duration, p.finished, UNIX_TIMESTAMP(p.datec) as datec, UNIX_TIMESTAMP(p.tms) as tms";
$sql_fix .= " FROM " . MAIN_DB_PREFIX . "product p";
$sql_fix .= " WHERE p.tms >= 0 LIMIT 1";

echo "Testing Fix Query (Hardcoded 0 Stock)... ";
$res = $db->query($sql_fix);
if ($res) {
    echo "OK (" . $db->num_rows($res) . " rows)\n";
    $obj = $db->fetch_object($res);
    echo "Sample data: " . json_encode($obj) . "\n";
} else {
    echo "FAIL: " . $db->lasterror() . "\n";
}

echo "=== DIAGNOSTIC END ===\n";
?>