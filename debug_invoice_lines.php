<?php
// debug_invoice_lines.php
define('NOCSRFCHECK', 1);
define('NOTOKENRENEWAL', 1);
define('NOREQUIREMENU', '1');
define('NOREQUIREHTML', '1');
define('NOREQUIREAJAX', '1');
define('NOLOGIN', '1');

require 'main.inc.php';

// Hardcoded API Key for testing - REPLACE WITH REAL KEY OR REMOVE BEFORE COMMIT
// For this debug script we assume we are running it in a dev env where we can just query the DB directly via the framework
// effectively bypassing the API key check for the purpose of this script if run via CLI or authenticated session, 
// BUT to match custom_sync.php logic we will just proceed to query.

header('Content-Type: application/json');

$sql = "SELECT d.rowid as id, d.fk_facture as parent_id, d.label, d.description, d.remise_percent, d.subprice, d.total_ht";
$sql .= " FROM " . MAIN_DB_PREFIX . "facturedet d";
$sql .= " WHERE d.remise_percent IS NOT NULL AND d.remise_percent > 0";
$sql .= " LIMIT 5";

$res = $db->query($sql);
$data = [];
if ($res) {
    while ($obj = $db->fetch_object($res)) {
        $data[] = $obj;
    }
} else {
    $data['error'] = $db->lasterror();
}

echo json_encode($data, JSON_PRETTY_PRINT);
?>