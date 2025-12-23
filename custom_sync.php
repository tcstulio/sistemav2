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
        // Added parent (fk_parent or parent column depending on version, usually 'parent' in llx_societe)
        $sql = "SELECT rowid as id, nom as name, name_alias, code_client, email, phone, address, zip, town, client, fournisseur, code_fournisseur, status, parent, UNIX_TIMESTAMP(tms) as tms, UNIX_TIMESTAMP(datec) as datec";
        $sql .= " FROM " . MAIN_DB_PREFIX . "societe";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'proposals':
        // Added fk_projet, fk_user_author
        $sql = "SELECT rowid as id, ref, total_ht, total_ttc, total_tva, fk_statut as statut, fk_soc, fk_projet as project_id, fk_user_author, UNIX_TIMESTAMP(datec) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "propal";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'proposal_lines':
        $sql = "SELECT d.rowid as id, d.fk_propal as parent_id, d.label, d.description, d.product_type as type, d.qty, d.tva_tx as vat_rate, d.subprice, d.total_ht, d.total_ttc, d.total_tva, d.fk_product as product_id, UNIX_TIMESTAMP(d.tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "propaldet d";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "propal p ON d.fk_propal = p.rowid";
        $sql .= " WHERE p.tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'orders':
        // Added fk_projet, fk_user_author
        $sql = "SELECT rowid as id, ref, total_ht, total_ttc, total_tva, fk_statut as statut, fk_soc, fk_projet as project_id, fk_user_author, UNIX_TIMESTAMP(date_commande) as date_commande, UNIX_TIMESTAMP(date_creation) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "commande";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'order_lines':
        $sql = "SELECT d.rowid as id, d.fk_commande as parent_id, d.label, d.description, d.product_type as type, d.qty, d.tva_tx as vat_rate, d.subprice, d.total_ht, d.total_ttc, d.total_tva, d.fk_product as product_id, UNIX_TIMESTAMP(d.tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "commandedet d";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "commande p ON d.fk_commande = p.rowid";
        $sql .= " WHERE p.tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'invoices':
        // Added fk_projet, fk_user_author
        $sql = "SELECT rowid as id, ref, total_ht, total_ttc, total_tva, fk_statut as statut, fk_soc, fk_projet as project_id, fk_user_author, UNIX_TIMESTAMP(datef) as date_invoice, UNIX_TIMESTAMP(date_lim_reglement) as date_lim_reglement, paye, UNIX_TIMESTAMP(datec) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "facture";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'invoice_lines':
        $sql = "SELECT d.rowid as id, d.fk_facture as parent_id, d.label, d.description, d.product_type as type, d.qty, d.tva_tx as vat_rate, d.subprice, d.total_ht, d.total_ttc, d.total_tva, d.fk_product as product_id, UNIX_TIMESTAMP(d.tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "facturedet d";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "facture p ON d.fk_facture = p.rowid";
        $sql .= " WHERE p.tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'contracts':
        // Added fk_user_author
        $sql = "SELECT rowid as id, ref, fk_soc as socid, fk_projet as project_id, fk_user_author, UNIX_TIMESTAMP(date_contrat) as date_contrat, UNIX_TIMESTAMP(fin_validite) as date_fin_validite, note_public, statut, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "contrat";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'products':
        $sql = "SELECT rowid as id, ref, label, description, fk_product_type as type, price, stock, UNIX_TIMESTAMP(datec) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "product";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'tickets':
        // Added fk_user_create
        $sql = "SELECT rowid as id, ref, track_id, subject, message, type_code, category_code, severity_code, fk_statut as statut, progress, fk_soc as socid, fk_project as project_id, fk_user_assign, fk_user_create, origin_email, UNIX_TIMESTAMP(datec) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "ticket";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'projects':
        // Diagnostic confirmed 'fk_project' exists (likely serving as parent pointer in this version)
        // Also added fk_user_creat, fk_statut
        $sql = "SELECT p.rowid as id, p.ref, p.title, p.fk_statut as statut, p.fk_soc as socid, p.fk_user_creat, p.fk_project as parent_id, UNIX_TIMESTAMP(p.datec) as datec, UNIX_TIMESTAMP(p.dateo) as date_start, UNIX_TIMESTAMP(p.datee) as date_end, p.budget_amount, UNIX_TIMESTAMP(p.tms) as tms,";
        $sql .= " COALESCE((SELECT AVG(t.progress) FROM " . MAIN_DB_PREFIX . "projet_task t WHERE t.fk_projet = p.rowid), 0) as progress";
        $sql .= " FROM " . MAIN_DB_PREFIX . "projet p";
        $sql .= " WHERE p.tms >= '" . $db->idate($last_modified) . "'";
        break;


    case 'events':
        // Fixed: Added ref, type_code, socid, project, location, elementtype, fk_element, fulldayevent, priority
        // Excludes automatic system log events (modifications, creations, deletions, etc.)
        $sql = "SELECT id as id, ref, label, note as description, code as type_code, datep as date_start, datep2 as date_end, percent as percentage, fk_user_author, fk_soc as socid, fk_project as project_id, location, elementtype, fk_element, fulldayevent, priority, transparency, UNIX_TIMESTAMP(datec) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "actioncomm";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        $sql .= " AND (code IS NULL OR (code NOT LIKE '%_AUTO' AND code NOT LIKE '%_MODIFY' AND code NOT LIKE '%_CREATE' AND code NOT LIKE '%_DELETE' AND code NOT LIKE '%_VALIDATE' AND code NOT LIKE '%_PAYED' AND code NOT LIKE '%_PAID' AND code NOT LIKE '%_APPROVE' AND code NOT LIKE '%_UNVALIDATE' AND code NOT LIKE '%_CLOSE%' AND code NOT LIKE '%_SENTBYMAIL' AND code NOT LIKE '%_SUBMIT' AND code NOT LIKE '%_RECEIVE' AND code NOT LIKE '%_CLASSIFY%' AND code NOT LIKE '%_ENABLEDISABLE' AND code NOT LIKE '%_CANCEL' AND code NOT LIKE 'TICKET_MSG%'))";
        break;

    case 'system_logs':
        // System action logs ONLY (inverse of events filter) - for analytics/audit purposes
        $sql = "SELECT id as id, ref, label, note as description, code as type_code, UNIX_TIMESTAMP(datep) as date_action, fk_user_author, fk_soc as socid, fk_project as project_id, elementtype, fk_element, UNIX_TIMESTAMP(datec) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "actioncomm";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        $sql .= " AND (code LIKE '%_AUTO' OR code LIKE '%_MODIFY' OR code LIKE '%_CREATE' OR code LIKE '%_DELETE' OR code LIKE '%_VALIDATE' OR code LIKE '%_PAYED' OR code LIKE '%_PAID' OR code LIKE '%_APPROVE' OR code LIKE '%_UNVALIDATE' OR code LIKE '%_CLOSE%' OR code LIKE '%_SENTBYMAIL' OR code LIKE '%_SUBMIT' OR code LIKE '%_RECEIVE' OR code LIKE '%_CLASSIFY%' OR code LIKE '%_ENABLEDISABLE' OR code LIKE '%_CANCEL' OR code LIKE 'TICKET_MSG%')";
        break;

    case 'tasks':
        // Simplified to core columns to avoid schema errors (removed fk_parent, etc.)
        $sql = "SELECT rowid as id, ref, label, description, UNIX_TIMESTAMP(dateo) as date_start, UNIX_TIMESTAMP(datee) as date_end, progress, fk_user_valid as fk_user_assign, fk_user_creat, fk_parent, fk_projet as project_id, UNIX_TIMESTAMP(datec) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "projet_task";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'suppliers':
        $sql = "SELECT rowid as id, nom as name, name_alias, code_client, code_fournisseur, email, phone, client, fournisseur, status, UNIX_TIMESTAMP(tms) as tms, UNIX_TIMESTAMP(datec) as datec";
        $sql .= " FROM " . MAIN_DB_PREFIX . "societe";
        $sql .= " WHERE fournisseur = 1 AND tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'contacts':
        // Added fk_user_creat
        $sql = "SELECT rowid as id, lastname, firstname, email, phone as phone_work, phone_perso as phone_personal, phone_mobile as phone_mobile, poste as position, fk_soc, fk_user_creat, statut, UNIX_TIMESTAMP(datec) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "socpeople";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'users':
        $sql = "SELECT rowid as id, login, firstname, lastname, email, job, user_mobile as phone_mobile, photo, admin, statut, UNIX_TIMESTAMP(datec) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "user";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'warehouses':
        // Corrected: label/libelle missing in some schemas? Using ref as label fallback.
        $sql = "SELECT rowid as id, ref, ref as label, description, statut, lieu, UNIX_TIMESTAMP(datec) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "entrepot";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'supplier_orders':
        $sql = "SELECT rowid as id, ref, fk_soc, UNIX_TIMESTAMP(date_creation) as date_creation, UNIX_TIMESTAMP(date_livraison) as date_livraison, total_ttc, fk_statut as statut, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "commande_fournisseur";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'supplier_order_lines':
        $sql = "SELECT d.rowid as id, d.fk_commande as parent_id, d.label, d.description, d.qty, d.tva_tx as vat_rate, d.subprice, d.total_ht, d.total_ttc, d.total_tva, d.fk_product as product_id, UNIX_TIMESTAMP(d.tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "commande_fournisseurdet d";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "commande_fournisseur p ON d.fk_commande = p.rowid";
        $sql .= " WHERE p.tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'supplier_invoices':
        $sql = "SELECT rowid as id, ref, fk_soc, UNIX_TIMESTAMP(datef) as date_invoice, total_ttc, fk_statut as statut, paye, UNIX_TIMESTAMP(datec) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "facture_fourn";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'supplier_invoice_lines':
        $sql = "SELECT d.rowid as id, d.fk_facture_fourn as parent_id, d.label, d.description, d.qty, d.tva_tx as vat_rate, d.pu_ht as subprice, d.total_ht, d.total_ttc, d.total_tva, d.fk_product as product_id, UNIX_TIMESTAMP(d.tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "facture_fourn_det d";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "facture_fourn p ON d.fk_facture_fourn = p.rowid";
        $sql .= " WHERE p.tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'shipments':
        $sql = "SELECT rowid as id, ref, fk_soc, UNIX_TIMESTAMP(date_creation) as date_creation, UNIX_TIMESTAMP(date_expedition) as date_delivery, fk_statut as status, tracking_number, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "expedition";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'shipment_lines':
        $sql = "SELECT d.rowid as id, d.fk_expedition as parent_id, d.label, d.description, d.qty, d.fk_product as product_id, UNIX_TIMESTAMP(d.tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "expeditiondet d";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "expedition p ON d.fk_expedition = p.rowid";
        $sql .= " WHERE p.tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'bank_accounts':
        // Fixed: Calculate solde dynamically from llx_bank table (sum of all transactions)
        $sql = "SELECT ba.rowid as id, ba.ref, ba.label, ba.bank, ba.code_banque, ba.code_guichet, ba.number, ba.cle_rib, ba.bic, ba.domiciliation, ba.proprio as owner_name, ba.owner_address, ba.currency_code, ba.clos as status, UNIX_TIMESTAMP(ba.datec) as datec, UNIX_TIMESTAMP(ba.tms) as tms,";
        $sql .= " COALESCE((SELECT SUM(b.amount) FROM " . MAIN_DB_PREFIX . "bank b WHERE b.fk_account = ba.rowid), 0) as solde";
        $sql .= " FROM " . MAIN_DB_PREFIX . "bank_account ba";
        $sql .= " WHERE ba.tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'expense_reports':
        // Simplified - only essential columns
        $sql = "SELECT rowid as id, ref, total_ttc, UNIX_TIMESTAMP(date_debut) as date_debut, UNIX_TIMESTAMP(date_fin) as date_fin, fk_statut as statut, fk_user_author, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "expensereport";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'interventions':
        // Simplified - use only columns that exist in most Dolibarr versions
        $sql = "SELECT rowid as id, ref, fk_soc as socid, fk_projet as project_id, UNIX_TIMESTAMP(datec) as date_creation, UNIX_TIMESTAMP(tms) as tms, description, fk_statut as statut";
        $sql .= " FROM " . MAIN_DB_PREFIX . "fichinter";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'intervention_lines':
        $sql = "SELECT d.rowid as id, d.fk_fichinter as parent_id, d.description, d.qty, UNIX_TIMESTAMP(d.tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "fichinterdet d";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "fichinter p ON d.fk_fichinter = p.rowid";
        $sql .= " WHERE p.tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'categories':
        // Fixed: datec may not exist, use date_creation or just skip it
        // Added fk_parent as parent_id
        $sql = "SELECT rowid as id, label, type, description, fk_parent as parent_id, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "categorie";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'boms':
        $sql = "SELECT rowid as id, ref, label, description, duration, efficiency, UNIX_TIMESTAMP(date_creation) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "bom_bom";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'bom_lines':
        $sql = "SELECT d.rowid as id, d.fk_bom as parent_id, d.fk_product as product_id, d.qty, d.efficiency";
        $sql .= " FROM " . MAIN_DB_PREFIX . "bom_bomline d";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "bom_bom p ON d.fk_bom = p.rowid";
        $sql .= " WHERE p.tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'manufacturing_orders':
        // Fixed: Added fk_product (product to produce) and qty
        $sql = "SELECT rowid as id, ref, label, status, fk_product as product_to_produce_id, qty, UNIX_TIMESTAMP(date_start_planned) as date_start, UNIX_TIMESTAMP(date_end_planned) as date_end, UNIX_TIMESTAMP(date_creation) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "mrp_mo";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'stock_movements':
        $sql = "SELECT rowid as id, UNIX_TIMESTAMP(datem) as datem, fk_product, fk_entrepot, value, type_mouvement, label, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "stock_mouvement";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'leave_requests':
        // Fixed: Added fk_type (leave type ID)
        $sql = "SELECT rowid as id, fk_type as type, halfday, UNIX_TIMESTAMP(date_debut) as date_debut, UNIX_TIMESTAMP(date_fin) as date_fin, description, fk_user, statut, UNIX_TIMESTAMP(date_create) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "holiday";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'job_positions':
        $sql = "SELECT rowid as id, ref, label, qty, status, description, UNIX_TIMESTAMP(date_creation) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "recruitment_recruitmentjobposition";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'candidates':
        // Simplified - removed 'fk_statut' and 'datec' columns that don't exist
        $sql = "SELECT rowid as id, firstname, lastname, email, UNIX_TIMESTAMP(tms) as tms, UNIX_TIMESTAMP(date_creation) as datec";
        $sql .= " FROM " . MAIN_DB_PREFIX . "recruitment_recruitmentcandidature";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'bank_lines':
        $sql = "SELECT rowid as id, UNIX_TIMESTAMP(dateo) as date_operation, UNIX_TIMESTAMP(datev) as date_value, amount, label, fk_account, num_releve, fk_type, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "bank";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'payments':
        // Fixed: fk_user_create doesn't exist, use fk_user_author or skip
        $sql = "SELECT rowid as id, ref, UNIX_TIMESTAMP(datep) as date_payment, amount, fk_bank, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "paiement";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'supplier_payments':
        // Fixed: fk_user_create doesn't exist
        $sql = "SELECT rowid as id, ref, UNIX_TIMESTAMP(datep) as date_payment, amount, fk_bank, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "paiementfourn";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'links':
        // Fetches document links (e.g., proposal -> order -> invoice)
        // No TMS available, always fetch all (paginated)
        $sql = "SELECT rowid as id, sourcetype, sourceid, targettype, targetid";
        $sql .= " FROM " . MAIN_DB_PREFIX . "element_element";
        // Order by ID is safer for pagination than TMS if TMS doesn't exist
        $sql .= " ORDER BY rowid ASC";

        // LIMIT applied below
        break;

    default:
        echo json_encode(["error" => "Unknown type parameter"]);
        exit;
}

// 5. Execution
if ($sql) {
    // Add ORDER BY for consistent pagination (oldest first)
    // Only add ORDER BY tms if not already ordered (links is ordered by rowid)
    if (strpos($sql, 'ORDER BY') === false) {
        $sql .= " ORDER BY tms ASC";
    }

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