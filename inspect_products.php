<?php
// Define Dolibarr environment constants
if (!defined("NOCSRFCHECK")) define("NOCSRFCHECK", 1);
if (!defined("NOTOKENRENEWAL")) define("NOTOKENRENEWAL", 1);
if (!defined('NOREQUIREMENU')) define('NOREQUIREMENU', '1');
if (!defined('NOREQUIREHTML')) define('NOREQUIREHTML', '1');
if (!defined('NOREQUIREAJAX')) define('NOREQUIREAJAX', '1');
if (!defined('NOLOGIN')) define('NOLOGIN', '1');

// Load main Dolibarr environment
require 'main.inc.php';

header('Content-Type: text/plain');

echo "=== Product Table Columns & Sample Data ===\n";

// Fetch one product (type 0)
$sql = "SELECT * FROM " . MAIN_DB_PREFIX . "product WHERE fk_product_type = 0 LIMIT 1";
$res = $db->query($sql);

if ($res && $db->num_rows($res) > 0) {
    echo "\n--- SAMPLE PRODUCT (Type 0) ---\n";
    $obj = $db->fetch_object($res);
    foreach ($obj as $key => $value) {
        echo "[$key] => $value\n";
    }
} else {
    echo "\nNo products found.\n";
}

// Fetch one service (type 1)
$sql = "SELECT * FROM " . MAIN_DB_PREFIX . "product WHERE fk_product_type = 1 LIMIT 1";
$res = $db->query($sql);

if ($res && $db->num_rows($res) > 0) {
    echo "\n--- SAMPLE SERVICE (Type 1) ---\n";
    $obj = $db->fetch_object($res);
    foreach ($obj as $key => $value) {
        echo "[$key] => $value\n";
    }
} else {
    echo "\nNo services found.\n";
}

// List all columns formally
echo "\n--- ALL COLUMNS (via SHOW COLUMNS) ---\n";
$sql = "SHOW COLUMNS FROM " . MAIN_DB_PREFIX . "product";
$res = $db->query($sql);
if ($res) {
    while ($row = $db->fetch_array($res)) {
        echo $row['Field'] . " (" . $row['Type'] . ")\n";
    }
}

?>
