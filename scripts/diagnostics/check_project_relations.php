<?php
/**
 * Diagnostic Script: Check Project Relations
 * Usage: GET /check_project_relations.php?id=498&DOLAPIKEY=...
 * 
 * This script checks all major tables for records linked to a specific project ID.
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

// --- Auth Check ---
$apikey = GETPOST('DOLAPIKEY', 'none');
if (empty($apikey)) {
    $headers = apache_request_headers();
    if (!empty($headers['DOLAPIKEY'])) {
        $apikey = $headers['DOLAPIKEY'];
    }
}
$apikey = trim($apikey);

if (empty($apikey)) {
    // Simple key check via user traversal if not handled by main.inc
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
}
// ------------------

$project_id = GETPOST('id', 'int');
if (!$project_id)
    $project_id = 498; // Default to the requested ID if not provided

echo "<h1>Diagnostic Report: Project ID $project_id</h1>";

// 1. Verify Project Exists
$sql = "SELECT rowid, ref, title FROM " . MAIN_DB_PREFIX . "projet WHERE rowid = " . $db->escape($project_id);
$res = $db->query($sql);
if ($res && $db->num_rows($res) > 0) {
    $proj = $db->fetch_object($res);
    echo "<h2 style='color:green'>Found Project: " . $proj->ref . " - " . $proj->title . "</h2>";
} else {
    echo "<h2 style='color:red'>Project ID $project_id NOT FOUND</h2>";
    exit;
}

// 2. Define Tables to Check
// Map: 'Label' => ['table' => 'tablename', 'col' => 'fk_projet_column', 'ref_col' => 'ref_column_name']
$tables_to_check = [
    'Proposals' => ['table' => 'propal', 'col' => 'fk_projet', 'ref_col' => 'ref'],
    'Orders' => ['table' => 'commande', 'col' => 'fk_projet', 'ref_col' => 'ref'],
    'Invoices' => ['table' => 'facture', 'col' => 'fk_projet', 'ref_col' => 'ref'],
    'Supplier Orders' => ['table' => 'commande_fournisseur', 'col' => 'fk_projet', 'ref_col' => 'ref'],
    'Supplier Invoices' => ['table' => 'facture_fourn', 'col' => 'fk_projet', 'ref_col' => 'ref'],
    'Contracts' => ['table' => 'contrat', 'col' => 'fk_projet', 'ref_col' => 'ref'],
    'Tickets' => ['table' => 'ticket', 'col' => 'fk_project', 'ref_col' => 'ref'], // Note: fk_project
    'Tasks' => ['table' => 'projet_task', 'col' => 'fk_projet', 'ref_col' => 'ref'],
    'Shipments' => ['table' => 'expedition', 'col' => 'fk_projet', 'ref_col' => 'ref'],
    'Expense Reports' => ['table' => 'expensereport', 'col' => 'fk_projet', 'ref_col' => 'ref'],
    'Interventions' => ['table' => 'fichinter', 'col' => 'fk_projet', 'ref_col' => 'ref'],
    'MO (Manufacturing)' => ['table' => 'mrp_mo', 'col' => 'fk_project', 'ref_col' => 'ref'],
    'Events/Agenda' => ['table' => 'actioncomm', 'col' => 'fk_project', 'ref_col' => 'id'], // Covers Events and System Logs
    'Sub-Projects' => ['table' => 'projet', 'col' => 'fk_project', 'ref_col' => 'ref'], // Projects that have this project as parent
];

// Modules reviewed but typically NOT linked directly to Project (no fk_project column):
// - Thirdparties (societe)
// - Products (product)
// - Bank Accounts (bank_account)
// - Payments (paiement, paiementfourn)
// - Stock Movements (stock_mouvement)
// - Leave Requests (holiday)
// - Recruitment (job positions, candidates)
// - BOMs (bom_bom) - typically linked to Product, not Project directly (though MOs are)


echo "<h2>Direct Relations (Foreign Keys)</h2>";
echo "<table border='1' cellpadding='5' style='border-collapse:collapse; width:100%;'>";
echo "<tr style='background:#ccc'><th>Module</th><th>Count</th><th>Items (IDs/Refs)</th></tr>";

foreach ($tables_to_check as $label => $info) {
    $table = MAIN_DB_PREFIX . $info['table'];
    $col = $info['col'];
    $ref_col = $info['ref_col'] ?? 'rowid';

    // 1. Determine Primary Key Name (rowid vs id)
    // Most tables use 'rowid', but actioncomm uses 'id'.
    $pk_col = 'rowid';
    if ($info['table'] === 'actioncomm') {
        $pk_col = 'id';
    }

    // 2. Handle Potential Column Alternatives (e.g. fk_projet vs fk_project)
    $possible_cols = [$col];
    if ($col === 'fk_projet') {
        $possible_cols[] = 'fk_project';
    }

    $res_check = false;
    $used_col = '';
    $last_error = '';

    foreach ($possible_cols as $try_col) {
        $sql_check = "SELECT $pk_col as id, $ref_col as ref FROM $table WHERE $try_col = " . $db->escape($project_id);
        $res_check = $db->query($sql_check);
        if ($res_check) {
            $used_col = $try_col;
            break;
        } else {
            $last_error = $db->lasterror();
        }
    }

    echo "<tr>";
    echo "<td><strong>$label</strong></td>";

    if ($res_check) {
        $count = $db->num_rows($res_check);
        echo "<td style='text-align:center'>$count</td>";
        echo "<td>";
        if ($count > 0) {
            $items = [];
            while ($obj = $db->fetch_object($res_check)) {
                $ref_val = $obj->ref ?? 'N/A';
                // For events, ref might be null, so use label check if ref missing? Or just ID.
                $items[] = "ID:" . $obj->id . " (" . $ref_val . ")";
            }
            echo implode(", ", array_slice($items, 0, 50));
            if ($count > 50)
                echo "... and " . ($count - 50) . " more";

            if ($count > 0 && $used_col !== $col) {
                echo "<br><span style='font-size:0.8em; color:orange'>(Found via $used_col)</span>";
            }
        } else {
            echo "-";
        }
        echo "</td>";
    } else {
        echo "<td colspan='2' style='color:red'>Error: " . $last_error . "</td>";
    }
    echo "</tr>";
}
echo "</table>";

// 3. Check Generic Links (llx_element_element)
echo "<h2>Generic Links (llx_element_element)</h2>";

// Schema Check for element_element: usually sourceid/targetid, but older could be fk_source/fk_target
// We'll try standard first.
$link_table = MAIN_DB_PREFIX . "element_element";

// Try standard columns
$sql_links = "SELECT rowid, sourcetype, sourceid, targettype, targetid FROM $link_table";
$sql_links .= " WHERE (sourceid = " . $db->escape($project_id) . " AND sourcetype = 'project')";
$sql_links .= " OR (targetid = " . $db->escape($project_id) . " AND targettype = 'project')";

$res_links = $db->query($sql_links);

// If failed, try alternative columns (fk_source/fk_target)
if (!$res_links) {
    $sql_links = "SELECT rowid, sourcetype, fk_source as sourceid, targettype, fk_target as targetid FROM $link_table";
    $sql_links .= " WHERE (fk_source = " . $db->escape($project_id) . " AND sourcetype = 'project')";
    $sql_links .= " OR (fk_target = " . $db->escape($project_id) . " AND targettype = 'project')";
    $res_links = $db->query($sql_links);
}

if ($res_links) {
    $count_links = $db->num_rows($res_links);
    echo "<p>Found <strong>$count_links</strong> generic links.</p>";
    if ($count_links > 0) {
        echo "<table border='1' cellpadding='5' style='border-collapse:collapse;'>";
        echo "<tr style='background:#eee'><th>Link ID</th><th>Direction</th><th>Related Type</th><th>Related ID</th></tr>";
        while ($link = $db->fetch_object($res_links)) {
            $direction = ($link->sourceid == $project_id && $link->sourcetype == 'project') ? "Outgoing (Source)" : "Incoming (Target)";
            $relType = ($direction == "Outgoing (Source)") ? $link->targettype : $link->sourcetype;
            $relId = ($direction == "Outgoing (Source)") ? $link->targetid : $link->sourceid;

            echo "<tr>";
            echo "<td>" . $link->rowid . "</td>";
            echo "<td>$direction</td>";
            echo "<td>$relType</td>";
            echo "<td>$relId</td>";
            echo "</tr>";
        }
        echo "</table>";
    }
} else {
    echo "<p style='color:red'>Error checking links: " . $db->lasterror() . "</p>";
}

// ... (previous code)

echo "</table>";

// 4. Schema Inspector for Expense Reports
// Since we had an error finding the column, let's just look at what columns actually exist.
echo "<h2>Schema Inspection: Expense Reports (llx_expensereport)</h2>";
$sql_desc = "SHOW COLUMNS FROM " . MAIN_DB_PREFIX . "expensereport";
$res_desc = $db->query($sql_desc);
if ($res_desc) {
    echo "<table border='1' cellpadding='5' style='border-collapse:collapse; font-size:0.9em'>";
    echo "<tr style='background:#ddd'><th>Field</th><th>Type</th><th>Null</th><th>Key</th><th>Default</th></tr>";
    while ($row = $db->fetch_object($res_desc)) {
        // Highlight potentially relevant columns
        $style = "";
        if (strpos($row->Field, 'fk_') === 0 || strpos($row->Field, 'id') !== false) {
            $style = "max-width:200px; font-weight:bold; color:blue;";
        }
        echo "<tr>";
        echo "<td style='$style'>" . $row->Field . "</td>";
        echo "<td>" . $row->Type . "</td>";
        echo "<td>" . $row->Null . "</td>";
        echo "<td>" . $row->Key . "</td>";
        echo "<td>" . $row->Default . "</td>";
        echo "</tr>";
    }
    echo "</table>";
} else {
    echo "<p style='color:red'>Could not inspect table: " . $db->lasterror() . "</p>";
}

?>