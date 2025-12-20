<?php
/**
 * Custom Sync Endpoint for Dolibarr "True Delta Sync"
 * 
 * Place this file in your Dolibarr root directory (htdocs or www).
 * Usage: GET /custom_sync.php?type=thirdparties&last_modified=1700000000&DOLAPIKEY=...
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

require 'main.inc.php';

// 2. Authentication (Handling Encrypted Keys)
// Using 'none' to match user snippet
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
    print json_encode(['error' => 'Missing API Key']);
    exit;
}

// Logic: Database has 'dolcrypt:...' values. Direct SQL comparison fails.
// We must fetch users and let Dolibarr decrypt the key to compare.
$foundUser = null;

// Only check active users
// User snippet used 'statut', so we stick to that.
$sql_users = "SELECT rowid FROM " . MAIN_DB_PREFIX . "user WHERE statut = 1";
$res_users = $db->query($sql_users);

if ($res_users) {
    while ($u = $db->fetch_object($res_users)) {
        $tmp_user = new User($db);
        $tmp_user->fetch($u->rowid);

        // Compare plain text key with the user's decrypted key
        // Note: $tmp_user->api_key is getter that handles decryption if needed
        if ($tmp_user->api_key === $apikey) {
            $foundUser = $tmp_user;
            break;
        }
    }
}

if ($foundUser) {
    $user = $foundUser;
} else {
    http_response_code(401); // 401 Unauthorized
    print json_encode([
        'error' => 'Invalid API Key'
    ]);
    exit;
}

// 3. Parameters
$type = GETPOST('type', 'alpha'); // thirdparties, proposals, orders, invoices, contracts
$last_modified = GETPOST('last_modified', 'int'); // Timestamp (seconds)
$limit = GETPOST('limit', 'int'); // Optional: max records per request (default: 5000)
$offset = GETPOST('offset', 'int'); // Optional: pagination offset (default: 0)

// Adjust timestamp if sent in ms (JS style) to seconds (PHP/DB style)
if ($last_modified > 10000000000) {
    $last_modified = floor($last_modified / 1000);
}

// Set defaults for pagination
if (empty($limit) || $limit <= 0) {
    $limit = 5000; // Default limit increased from 2000
}
if ($limit > 10000) {
    $limit = 10000; // Max limit to prevent memory issues
}
if (empty($offset) || $offset < 0) {
    $offset = 0;
}

header('Content-Type: application/json');

$data = [];
$sql = "";

// 4. Query Builder
switch ($type) {
    case 'thirdparties':
        $sql = "SELECT rowid as id, nom as name, name_alias, code_client, email, phone, address, zip, town, client, fournisseur, code_fournisseur, status, tms, datec";
        $sql .= " FROM " . MAIN_DB_PREFIX . "societe";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'proposals':
        $sql = "SELECT rowid as id, ref, total_ht, total_ttc, total_tva, fk_statut as statut, fk_soc, datec, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "propal";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'orders':
        // Corrected: datec -> date_creation (common alias issue)
        $sql = "SELECT rowid as id, ref, total_ht, total_ttc, total_tva, fk_statut as statut, fk_soc, date_commande as date_commande, date_creation as datec, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "commande";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'invoices':
        $sql = "SELECT rowid as id, ref, total_ht, total_ttc, total_tva, fk_statut as statut, fk_soc, datef as date_invoice, paye, datec, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "facture";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'contracts':
        // Fixed: Added fk_projet, fin_validite (may be NULL), note_public
        $sql = "SELECT rowid as id, ref, fk_soc as socid, fk_projet as project_id, date_contrat, fin_validite as date_fin_validite, note_public, statut, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "contrat";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'products':
        $sql = "SELECT rowid as id, ref, label, description, fk_product_type as type, price, stock, datec, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "product";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'tickets':
        // Fixed: Added type_code, category_code, severity_code, progress, fk_user_assign, fk_project
        $sql = "SELECT rowid as id, ref, track_id, subject, message, type_code, category_code, severity_code, fk_statut as statut, progress, fk_soc as socid, fk_project as project_id, fk_user_assign, origin_email, datec, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "ticket";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'projects':
        // Fixed: Added progress calculation via subquery, fk_soc renamed to socid
        $sql = "SELECT p.rowid as id, p.ref, p.title, p.fk_statut as statut, p.fk_soc as socid, p.datec, p.dateo as date_start, p.datee as date_end, p.budget_amount, p.tms,";
        $sql .= " COALESCE((SELECT AVG(t.progress) FROM " . MAIN_DB_PREFIX . "projet_task t WHERE t.fk_projet = p.rowid), 0) as progress";
        $sql .= " FROM " . MAIN_DB_PREFIX . "projet p";
        $sql .= " WHERE p.tms >= '" . $db->idate($last_modified) . "'";
        break;


    case 'events':
        // Fixed: Added ref, type_code, socid, project, location, elementtype, fk_element, fulldayevent, priority
        // Excludes automatic system log events (modifications, creations, deletions, etc.)
        $sql = "SELECT id as id, ref, label, note as description, code as type_code, datep as date_start, datep2 as date_end, percent as percentage, fk_user_author, fk_soc as socid, fk_project as project_id, location, elementtype, fk_element, fulldayevent, priority, transparency, datec, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "actioncomm";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        $sql .= " AND (code IS NULL OR (code NOT LIKE '%_AUTO' AND code NOT LIKE '%_MODIFY' AND code NOT LIKE '%_CREATE' AND code NOT LIKE '%_DELETE' AND code NOT LIKE '%_VALIDATE'))";
        break;

    case 'tasks':
        // Fixed: Added planned_workload, duration_effective, fk_user_valid (assigned user)
        $sql = "SELECT rowid as id, ref, label, description, dateo as date_start, datee as date_end, progress, planned_workload, duration_effective, fk_user_valid as fk_user_assign, fk_user_creat, fk_projet as project_id, datec, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "projet_task";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'suppliers':
        $sql = "SELECT rowid as id, nom as name, name_alias, code_client, code_fournisseur, email, phone, client, fournisseur, status, tms, datec";
        $sql .= " FROM " . MAIN_DB_PREFIX . "societe";
        $sql .= " WHERE fournisseur = 1 AND tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'contacts':
        // Corrected: phone_pro -> phone (fallback)
        $sql = "SELECT rowid as id, lastname, firstname, email, phone as phone_work, phone_perso as phone_personal, phone_mobile as phone_mobile, poste as position, fk_soc, statut, datec, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "socpeople";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'users':
        $sql = "SELECT rowid as id, login, firstname, lastname, email, job, user_mobile as phone_mobile, photo, admin, statut, datec, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "user";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'warehouses':
        // Corrected: label/libelle missing in some schemas? Using ref as label fallback.
        $sql = "SELECT rowid as id, ref, ref as label, description, statut, lieu, datec, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "entrepot";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'supplier_orders':
        $sql = "SELECT rowid as id, ref, fk_soc, date_creation as date_creation, date_livraison, total_ttc, fk_statut as statut, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "commande_fournisseur";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'supplier_invoices':
        $sql = "SELECT rowid as id, ref, fk_soc, datef as date_invoice, total_ttc, fk_statut as statut, paye, datec, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "facture_fourn";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'shipments':
        $sql = "SELECT rowid as id, ref, fk_soc, fk_projet, fk_commande, date_creation, date_expedition as date_delivery, fk_statut as status, tracking_number, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "expedition";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'bank_accounts':
        // Fixed: Calculate solde dynamically from llx_bank table (sum of all transactions)
        $sql = "SELECT ba.rowid as id, ba.ref, ba.label, ba.bank, ba.code_banque, ba.code_guichet, ba.number, ba.cle_rib, ba.bic, ba.domiciliation, ba.proprio as owner_name, ba.owner_address, ba.currency_code, ba.clos as status, ba.datec, ba.tms,";
        $sql .= " COALESCE((SELECT SUM(b.amount) FROM " . MAIN_DB_PREFIX . "bank b WHERE b.fk_account = ba.rowid), 0) as solde";
        $sql .= " FROM " . MAIN_DB_PREFIX . "bank_account ba";
        $sql .= " WHERE ba.tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'expense_reports':
        // Simplified - only essential columns
        $sql = "SELECT rowid as id, ref, total_ttc, date_debut, date_fin, fk_statut as statut, fk_user_author, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "expensereport";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'interventions':
        // Simplified - use only columns that exist in most Dolibarr versions
        $sql = "SELECT rowid as id, ref, fk_soc as socid, fk_projet as project_id, datec as date_creation, tms, description, fk_statut as statut";
        $sql .= " FROM " . MAIN_DB_PREFIX . "fichinter";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'categories':
        // Fixed: datec may not exist, use date_creation or just skip it
        $sql = "SELECT rowid as id, label, type, description, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "categorie";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'boms':
        $sql = "SELECT rowid as id, ref, label, description, duration, efficiency, date_creation as datec, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "bom_bom";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'manufacturing_orders':
        // Fixed: Added fk_product (product to produce) and qty
        $sql = "SELECT rowid as id, ref, label, status, fk_product as product_to_produce_id, qty, date_start_planned as date_start, date_end_planned as date_end, fk_projet as project_id, date_creation as datec, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "mrp_mo";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'stock_movements':
        $sql = "SELECT rowid as id, datem, fk_product, fk_entrepot, value, type_mouvement, label, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "stock_mouvement";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'leave_requests':
        // Fixed: Added fk_type (leave type ID)
        $sql = "SELECT rowid as id, fk_type as type, halfday, date_debut, date_fin, description, fk_user, statut, date_create as datec, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "holiday";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'job_positions':
        // Simplified - removed 'status' column that doesn't exist
        $sql = "SELECT rowid as id, label, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "hrm_job";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'candidates':
        // Simplified - removed 'fk_statut' column that doesn't exist
        $sql = "SELECT rowid as id, firstname, lastname, email, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "recruitment_recruitmentcandidature";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'bank_lines':
        $sql = "SELECT rowid as id, dateo as date_operation, datev as date_value, amount, label, fk_account, num_releve, fk_type, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "bank";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'payments':
        // Fixed: fk_user_create doesn't exist, use fk_user_author or skip
        $sql = "SELECT rowid as id, ref, datep as date_payment, amount, fk_bank, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "paiement";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'supplier_payments':
        // Fixed: fk_user_create doesn't exist
        $sql = "SELECT rowid as id, ref, datep as date_payment, amount, fk_bank, tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "paiementfourn";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    default:
        echo json_encode(["error" => "Unknown type parameter"]);
        exit;
}

// 5. Execution
if ($sql) {
    // Add ORDER BY for consistent pagination (oldest first)
    $sql .= " ORDER BY tms ASC";

    // Apply limit and offset for pagination
    $sql .= " LIMIT " . $limit . " OFFSET " . $offset;

    $res = $db->query($sql);
    if ($res) {
        while ($obj = $db->fetch_object($res)) {
            $data[] = $obj;
        }
    } else {
        echo json_encode(["error" => $db->lasterror()]);
        exit;
    }
}

// Return data with pagination info
$response = [
    "data" => $data,
    "pagination" => [
        "offset" => $offset,
        "limit" => $limit,
        "count" => count($data),
        "has_more" => count($data) >= $limit
    ]
];

echo json_encode($response);
?>