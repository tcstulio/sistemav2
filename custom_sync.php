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
        // Added fk_projet, fk_user_author, fk_user_valid
        $sql = "SELECT rowid as id, ref, total_ht, total_ttc, total_tva, fk_statut as statut, fk_soc, fk_projet as project_id, fk_user_author, fk_user_valid, UNIX_TIMESTAMP(datec) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "propal";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'proposal_lines':
        $sql = "SELECT d.rowid as id, d.fk_propal as parent_id, d.label, d.description, d.product_type as type, d.qty, d.tva_tx as vat_rate, d.remise_percent, d.subprice, d.total_ht, d.total_ttc, d.total_tva, d.fk_product as product_id, d.rang as rang, UNIX_TIMESTAMP(p.tms) as tms, UNIX_TIMESTAMP(p.tms) as parent_tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "propaldet d";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "propal p ON d.fk_propal = p.rowid";
        $sql .= " WHERE p.tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'orders':
        // Added fk_projet, fk_user_author, fk_user_valid
        $sql = "SELECT rowid as id, ref, total_ht, total_ttc, total_tva, fk_statut as statut, fk_soc, fk_projet as project_id, fk_user_author, fk_user_valid, UNIX_TIMESTAMP(date_commande) as date_commande, UNIX_TIMESTAMP(date_creation) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "commande";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'order_lines':
        $sql = "SELECT d.rowid as id, d.fk_commande as parent_id, d.label, d.description, d.product_type as type, d.qty, d.tva_tx as vat_rate, d.subprice, d.total_ht, d.total_ttc, d.total_tva, d.fk_product as product_id, d.rang as rang, UNIX_TIMESTAMP(p.tms) as tms, UNIX_TIMESTAMP(p.tms) as parent_tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "commandedet d";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "commande p ON d.fk_commande = p.rowid";
        $sql .= " WHERE p.tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'invoices':
        // Added fk_projet, fk_user_author, fk_user_valid
        $sql = "SELECT rowid as id, ref, total_ht, total_ttc, total_tva, fk_statut as statut, fk_soc, fk_projet as project_id, fk_user_author, fk_user_valid, UNIX_TIMESTAMP(datef) as date_invoice, UNIX_TIMESTAMP(date_lim_reglement) as date_lim_reglement, paye, UNIX_TIMESTAMP(datec) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "facture";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'invoice_lines':
        $sql = "SELECT d.rowid as id, d.fk_facture as parent_id, d.label, d.description, d.product_type as type, d.qty, d.tva_tx as vat_rate, d.remise_percent, d.subprice, d.total_ht, d.total_ttc, d.total_tva, d.fk_product as product_id, prod.ref as product_ref, prod.label as product_label, d.rang as rang, UNIX_TIMESTAMP(p.tms) as tms, UNIX_TIMESTAMP(p.tms) as parent_tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "facturedet d";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "facture p ON d.fk_facture = p.rowid";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "product prod ON d.fk_product = prod.rowid";
        $sql .= " WHERE p.tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'contracts':
        // Added fk_user_author
        $sql = "SELECT rowid as id, ref, fk_soc as socid, fk_projet as project_id, fk_user_author, UNIX_TIMESTAMP(date_contrat) as date_contrat, UNIX_TIMESTAMP(fin_validite) as date_fin_validite, note_public, statut, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "contrat";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'products':
        $sql = "SELECT p.rowid as id, p.ref, p.label, p.description, p.fk_product_type as type, p.price, p.price_ttc, p.tva_tx as vat_rate, ";
        $sql .= " COALESCE((SELECT SUM(ps.reel) FROM " . MAIN_DB_PREFIX . "product_stock ps WHERE ps.fk_product = p.rowid), 0) as stock, ";
        $sql .= " (SELECT GROUP_CONCAT(cp.fk_categorie) FROM " . MAIN_DB_PREFIX . "categorie_product cp WHERE cp.fk_product = p.rowid) as category_ids, ";
        $sql .= " p.tosell, p.tobuy, p.duration, p.finished, UNIX_TIMESTAMP(p.datec) as datec, UNIX_TIMESTAMP(p.tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "product p";
        $sql .= " WHERE p.tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'tickets':
        // Added fk_user_create, fk_user_assign, fk_user_close
        // JOIN with extrafields to get custom options (AI context, etc.)
        $sql = "SELECT t.rowid as id, t.ref, t.track_id, t.subject, t.message, t.type_code, t.category_code, t.severity_code, t.fk_statut as statut, t.progress, t.fk_soc as socid, t.fk_project as project_id, t.fk_user_assign, t.fk_user_create, t.origin_email, UNIX_TIMESTAMP(t.datec) as datec, UNIX_TIMESTAMP(t.tms) as tms,";
        // Select all columns from extrafields that start with 'options_' prefix convention
        $sql .= " te.resumo_da_conversa as options_resumo_da_conversa, te.resumo_vaga as options_resumo_vaga, te.quantidade_publico_evento as options_quantidade_publico_evento, te.valor_budget as options_valor_budget, te.cf_session_id as options_cf_session_id";
        $sql .= " FROM " . MAIN_DB_PREFIX . "ticket t";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "ticket_extrafields te ON t.rowid = te.fk_object";
        $sql .= " WHERE t.tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'projects':
        // Diagnostic confirmed 'fk_project' exists (likely serving as parent pointer in this version)
        // Also added fk_user_creat, fk_statut, fk_user_modif
        $sql = "SELECT p.rowid as id, p.ref, p.title, p.fk_statut as statut, p.fk_soc as socid, p.fk_user_creat, p.fk_user_modif, p.fk_project as parent_id, UNIX_TIMESTAMP(p.datec) as datec, UNIX_TIMESTAMP(p.dateo) as date_start, UNIX_TIMESTAMP(p.datee) as date_end, p.budget_amount, UNIX_TIMESTAMP(p.tms) as tms,";
        $sql .= " COALESCE((SELECT AVG(t.progress) FROM " . MAIN_DB_PREFIX . "projet_task t WHERE t.fk_projet = p.rowid), 0) as progress";
        $sql .= " FROM " . MAIN_DB_PREFIX . "projet p";
        $sql .= " WHERE p.tms >= '" . $db->idate($last_modified) . "'";
        break;


    case 'events':
        // Fixed: Added ref, type_code, socid, project, location, elementtype, fk_element, fulldayevent, priority
        // Excludes automatic system log events (modifications, creations, deletions, etc.)
        // Added JOIN to user table to get author name
        $sql = "SELECT a.id as id, a.ref, a.label, a.note as description, a.code as type_code, UNIX_TIMESTAMP(a.datep) as date_start, UNIX_TIMESTAMP(a.datep2) as date_end, a.percent as percentage, a.fk_user_author, u.firstname as user_author_firstname, u.lastname as user_author_lastname, u.login as user_author_login, a.fk_soc as socid, a.fk_project as project_id, a.location, a.elementtype, a.fk_element, a.fulldayevent, a.priority, a.transparency, UNIX_TIMESTAMP(a.datec) as datec, UNIX_TIMESTAMP(a.tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "actioncomm a";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "user u ON a.fk_user_author = u.rowid";
        $sql .= " WHERE a.tms >= '" . $db->idate($last_modified) . "'";
        $sql .= " AND (a.code IS NULL OR (a.code NOT LIKE '%_AUTO' AND a.code NOT LIKE '%_MODIFY' AND a.code NOT LIKE '%_CREATE' AND a.code NOT LIKE '%_DELETE' AND a.code NOT LIKE '%_VALIDATE' AND a.code NOT LIKE '%_PAYED' AND a.code NOT LIKE '%_PAID' AND a.code NOT LIKE '%_APPROVE' AND a.code NOT LIKE '%_UNVALIDATE' AND a.code NOT LIKE '%_CLOSE%' AND a.code NOT LIKE '%_SENTBYMAIL' AND a.code NOT LIKE '%_SUBMIT' AND a.code NOT LIKE '%_RECEIVE' AND a.code NOT LIKE '%_CLASSIFY%' AND a.code NOT LIKE '%_ENABLEDISABLE' AND a.code NOT LIKE '%_CANCEL' AND a.code NOT LIKE 'TICKET_MSG%' AND a.code != 'AC_USER_NEW_PASSWORD'))";
        break;

    case 'system_logs':
        // System action logs ONLY (inverse of events filter) - for analytics/audit purposes
        $sql = "SELECT id as id, ref, label, note as description, code as type_code, UNIX_TIMESTAMP(datep) as date_action, fk_user_author, fk_soc as socid, fk_project as project_id, elementtype, fk_element, UNIX_TIMESTAMP(datec) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "actioncomm";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        $sql .= " AND (code LIKE '%_AUTO' OR code LIKE '%_MODIFY' OR code LIKE '%_CREATE' OR code LIKE '%_DELETE' OR code LIKE '%_VALIDATE' OR code LIKE '%_PAYED' OR code LIKE '%_PAID' OR code LIKE '%_APPROVE' OR code LIKE '%_UNVALIDATE' OR code LIKE '%_CLOSE%' OR code LIKE '%_SENTBYMAIL' OR code LIKE '%_SUBMIT' OR code LIKE '%_RECEIVE' OR code LIKE '%_CLASSIFY%' OR code LIKE '%_ENABLEDISABLE' OR code LIKE '%_CANCEL' OR code LIKE 'TICKET_MSG%' OR code = 'AC_USER_NEW_PASSWORD')";
        break;

    case 'tasks':
        // Simplified to core columns to avoid schema errors (removed fk_parent, etc.)
        // Added JOIN with project to get title/ref
        $sql = "SELECT t.rowid as id, t.ref, t.label, t.description, UNIX_TIMESTAMP(t.dateo) as date_start, UNIX_TIMESTAMP(t.datee) as date_end, t.progress, t.priority, t.planned_workload, t.duration_effective, t.fk_user_valid as fk_user_assign, t.fk_user_creat, t.fk_task_parent as fk_parent, t.fk_projet as project_id, p.ref as project_ref, p.title as project_title, t.fk_statut as status, UNIX_TIMESTAMP(t.datec) as datec, UNIX_TIMESTAMP(t.tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "projet_task t";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "projet p ON t.fk_projet = p.rowid";
        $sql .= " WHERE t.tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'supplier_proposals':
        // Supplier Proposals (Ask for Price)
        // Table: llx_supplier_proposal
        $sql = "SELECT rowid as id, ref, fk_soc as socid, fk_projet as project_id, fk_user_author, fk_user_valid, total_ht, total_ttc, total_tva, fk_statut as statut, UNIX_TIMESTAMP(date_valid) as date_valid, UNIX_TIMESTAMP(date_livraison) as date_delivery, UNIX_TIMESTAMP(datec) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "supplier_proposal";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'supplier_proposal_lines':
        // Supplier Proposal Lines
        // Table: llx_supplier_proposaldet
        $sql = "SELECT d.rowid as id, d.fk_supplier_proposal as parent_id, d.description, d.qty, d.pu_ht as subprice, d.total_ht, d.total_ttc, d.total_tva, d.tva_tx as vat_rate, d.fk_product as product_id, d.rang as rang, UNIX_TIMESTAMP(p.tms) as tms, UNIX_TIMESTAMP(p.tms) as parent_tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "supplier_proposaldet d";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "supplier_proposal p ON d.fk_supplier_proposal = p.rowid";
        $sql .= " WHERE p.tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'task_time_logs':
        // Time spent on tasks
        // Table: llx_element_time (Replaces older llx_projet_task_time)
        // Duration is already in seconds (e.g. 3600 = 1h)
        // Added element_datehour to get precise start time if available
        $sql = "SELECT rowid as id, fk_element as task_id, UNIX_TIMESTAMP(element_date) as date, UNIX_TIMESTAMP(element_datehour) as date_start, element_duration as duration, fk_user as user_id, note, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "element_time";
        $sql .= " WHERE elementtype = 'task'";
        $sql .= " AND tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'task_contacts':
        // Contacts/Users linked to tasks
        // Logic: 
        // If tc.source = 'internal', c.fk_socpeople is USER ID.
        // If tc.source = 'external', c.fk_socpeople is CONTACT ID.
        $sql = "SELECT c.rowid as id, c.element_id as task_id, c.fk_c_type_contact as type_id, UNIX_TIMESTAMP(t.tms) as tms,";
        $sql .= " CASE WHEN tc.source = 'internal' THEN c.fk_socpeople ELSE u_linked.rowid END as user_id,";
        $sql .= " CASE WHEN tc.source = 'external' THEN c.fk_socpeople ELSE u_internal.fk_socpeople END as contact_id";
        $sql .= " FROM " . MAIN_DB_PREFIX . "element_contact c";
        $sql .= " INNER JOIN " . MAIN_DB_PREFIX . "c_type_contact tc ON c.fk_c_type_contact = tc.rowid";
        $sql .= " INNER JOIN " . MAIN_DB_PREFIX . "projet_task t ON c.element_id = t.rowid";
        // Join for Internal Source (c.fk_socpeople = user_id)
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "user u_internal ON (tc.source = 'internal' AND c.fk_socpeople = u_internal.rowid)";
        // Join for External Source (c.fk_socpeople = contact_id -> linked to user)
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "user u_linked ON (tc.source = 'external' AND c.fk_socpeople = u_linked.fk_socpeople)";
        $sql .= " WHERE tc.element = 'project_task'";
        $sql .= " AND t.tms >= '" . $db->idate($last_modified) . "'";
        $sql .= " ORDER BY t.tms ASC";
        break;

    case 'project_contacts':
        // Contacts/Users linked to projects
        $sql = "SELECT c.rowid as id, c.element_id as project_id, c.fk_c_type_contact as type_id, UNIX_TIMESTAMP(p.tms) as tms,";
        $sql .= " CASE WHEN tc.source = 'internal' THEN c.fk_socpeople ELSE u_linked.rowid END as user_id,";
        $sql .= " CASE WHEN tc.source = 'external' THEN c.fk_socpeople ELSE u_internal.fk_socpeople END as contact_id";
        $sql .= " FROM " . MAIN_DB_PREFIX . "element_contact c";
        $sql .= " INNER JOIN " . MAIN_DB_PREFIX . "c_type_contact tc ON c.fk_c_type_contact = tc.rowid";
        $sql .= " INNER JOIN " . MAIN_DB_PREFIX . "projet p ON c.element_id = p.rowid";
        // Join for Internal Source
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "user u_internal ON (tc.source = 'internal' AND c.fk_socpeople = u_internal.rowid)";
        // Join for External Source
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "user u_linked ON (tc.source = 'external' AND c.fk_socpeople = u_linked.fk_socpeople)";
        $sql .= " WHERE tc.element = 'project'";
        $sql .= " AND p.tms >= '" . $db->idate($last_modified) . "'";
        $sql .= " ORDER BY p.tms ASC";
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
        $sql = "SELECT rowid as id, login, firstname, lastname, email, job, user_mobile as phone_mobile, photo, admin, statut, fk_user as supervisor_id, UNIX_TIMESTAMP(datec) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "user";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'groups':
        // Sync User Groups
        $sql = "SELECT rowid as id, nom as name, note, UNIX_TIMESTAMP(datec) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "usergroup";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'group_users':
        // Link between Users and Groups
        // Table: llx_usergroup_user (fk_user, fk_usergroup)
        // No TMS usually on link tables, use rowid for incremental or full sync if small
        $sql = "SELECT rowid as id, fk_user as user_id, fk_usergroup as group_id";
        $sql .= " FROM " . MAIN_DB_PREFIX . "usergroup_user";
        // Logic for incremental sync on link tables without TMS:
        if ($last_modified > 31536000) {
            $last_modified = 0;
        }
        if ($last_modified > 0) {
            $sql .= " WHERE rowid > " . intval($last_modified);
        }
        $sql .= " ORDER BY rowid ASC";
        break;

    case 'group_rights':
        // Link table: fk_usergroup, fk_id (right id)
        $sql = "SELECT rowid as id, fk_usergroup, fk_id FROM " . MAIN_DB_PREFIX . "usergroup_rights";
        if ($last_modified > 31536000) {
            $last_modified = 0;
        }
        if ($last_modified > 0) {
            $sql .= " WHERE rowid > " . intval($last_modified);
        }
        $sql .= " ORDER BY rowid ASC";
        break;

    case 'user_rights':
        // Link table: fk_user, fk_id (right id)
        $sql = "SELECT rowid as id, fk_user, fk_id FROM " . MAIN_DB_PREFIX . "user_rights";
        if ($last_modified > 31536000) {
            $last_modified = 0;
        }
        if ($last_modified > 0) {
            $sql .= " WHERE rowid > " . intval($last_modified);
        }
        $sql .= " ORDER BY rowid ASC";
        break;

    case 'permissions':
        // llx_rights_def: id, libelle, module, perms, subperms, type
        $sql = "SELECT id, libelle, module, perms, subperms, type, module_position, family_position FROM " . MAIN_DB_PREFIX . "rights_def";
        if ($last_modified > 31536000) {
            $last_modified = 0;
        }
        if ($last_modified > 0) {
            $sql .= " WHERE id > " . intval($last_modified);
        }
        $sql .= " ORDER BY id ASC";
        break;

    case 'warehouses':
        // Corrected: label/libelle missing in some schemas? Using ref as label fallback.
        $sql = "SELECT rowid as id, ref, ref as label, description, statut, lieu, UNIX_TIMESTAMP(datec) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "entrepot";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'supplier_orders':
        $sql = "SELECT rowid as id, ref, fk_soc, fk_projet as project_id, fk_user_author, fk_user_approve, UNIX_TIMESTAMP(date_creation) as date_creation, UNIX_TIMESTAMP(date_livraison) as date_livraison, total_ttc, fk_statut as statut, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "commande_fournisseur";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'supplier_order_lines':
        $sql = "SELECT d.rowid as id, d.fk_commande as parent_id, d.label, d.description, d.qty, d.tva_tx as vat_rate, d.subprice, d.total_ht, d.total_ttc, d.total_tva, d.fk_product as product_id, d.rang as rang, UNIX_TIMESTAMP(p.tms) as tms, UNIX_TIMESTAMP(p.tms) as parent_tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "commande_fournisseurdet d";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "commande_fournisseur p ON d.fk_commande = p.rowid";
        $sql .= " WHERE p.tms >= '" . $db->idate($last_modified) . "'";
        break;



    case 'shipments':
        $sql = "SELECT rowid as id, ref, fk_soc, fk_projet as project_id, fk_user_author, fk_user_valid, UNIX_TIMESTAMP(date_creation) as date_creation, UNIX_TIMESTAMP(date_expedition) as date_delivery, fk_statut as status, tracking_number, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "expedition";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'shipment_lines':
        $sql = "SELECT d.rowid as id, d.fk_expedition as parent_id, d.label, d.description, d.qty, d.fk_product as product_id, d.rang as rang, UNIX_TIMESTAMP(p.tms) as tms, UNIX_TIMESTAMP(p.tms) as parent_tms";
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
        // Fixed: Removed fk_projet (column does not exist in this version), returning NULL as project_id for compatibility
        $sql = "SELECT rowid as id, ref, total_ttc, NULL as project_id, UNIX_TIMESTAMP(date_debut) as date_debut, UNIX_TIMESTAMP(date_fin) as date_fin, fk_statut as statut, fk_user_author, fk_user_valid, fk_user_approve, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "expensereport";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'interventions':
        // Added fk_user_author, duree
        $sql = "SELECT rowid as id, ref, fk_soc as socid, fk_projet as project_id, fk_user_author, duree as duration, UNIX_TIMESTAMP(datec) as date_creation, UNIX_TIMESTAMP(tms) as tms, description, fk_statut as statut";
        $sql .= " FROM " . MAIN_DB_PREFIX . "fichinter";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'intervention_lines':
        // Added duree. Removed qty (not present in table)
        $sql = "SELECT d.rowid as id, d.fk_fichinter as parent_id, d.description, d.duree as duration, d.rang as rang, UNIX_TIMESTAMP(p.tms) as tms, UNIX_TIMESTAMP(p.tms) as parent_tms";
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
        // Fixed: Added fk_product (main product), status, qty
        $sql = "SELECT rowid as id, ref, label, description, fk_product, qty, status, duration, efficiency, UNIX_TIMESTAMP(date_creation) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "bom_bom";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'bom_lines':
        $sql = "SELECT d.rowid as id, d.fk_bom as parent_id, d.fk_product as product_id, d.qty, d.efficiency, UNIX_TIMESTAMP(p.tms) as tms, UNIX_TIMESTAMP(p.tms) as parent_tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "bom_bomline d";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "bom_bom p ON d.fk_bom = p.rowid";
        $sql .= " WHERE p.tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'manufacturing_orders':
        // Fixed: Added fk_product (product to produce), qty, and fk_project
        $sql = "SELECT rowid as id, ref, label, status, fk_product as product_to_produce_id, qty, fk_project as project_id, UNIX_TIMESTAMP(date_start_planned) as date_start, UNIX_TIMESTAMP(date_end_planned) as date_end, UNIX_TIMESTAMP(date_creation) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "mrp_mo";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'stock_movements':
        $sql = "SELECT rowid as id, UNIX_TIMESTAMP(datem) as datem, fk_product, fk_entrepot, value, type_mouvement, label, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "stock_mouvement";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'leave_requests':
        // Fixed: Added fk_type (leave type ID), ref. Added fk_user_valid (approver)
        $sql = "SELECT rowid as id, ref, fk_type as type, halfday, UNIX_TIMESTAMP(date_debut) as date_debut, UNIX_TIMESTAMP(date_fin) as date_fin, description, fk_user, fk_user_valid, statut, UNIX_TIMESTAMP(date_create) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "holiday";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'job_positions':
        $sql = "SELECT rowid as id, ref, label, qty, status, description, UNIX_TIMESTAMP(date_creation) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "recruitment_recruitmentjobposition";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'candidates':
        // Fixed: Added fk_recruitmentjobposition, phone, ref, status
        $sql = "SELECT rowid as id, ref, firstname, lastname, email, phone, fk_recruitmentjobposition, status, UNIX_TIMESTAMP(tms) as tms, UNIX_TIMESTAMP(date_creation) as datec";
        $sql .= " FROM " . MAIN_DB_PREFIX . "recruitment_recruitmentcandidature";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'bank_lines':
        $sql = "SELECT rowid as id, UNIX_TIMESTAMP(dateo) as date_operation, UNIX_TIMESTAMP(datev) as date_value, amount, label, fk_account, num_releve, fk_type, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "bank";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;



    case 'debug_schema':
        $table = GETPOST('table', 'alpha');
        if (empty($table))
            $table = 'paiementfourn';
        $sql = "DESCRIBE " . MAIN_DB_PREFIX . $table;
        break;
    case 'payments':
        $sql = "SELECT p.rowid as id, p.ref, UNIX_TIMESTAMP(p.datep) as date_payment, p.amount, p.fk_bank as transaction_id, b.fk_account as bank_account_id, p.num_paiement, p.note, p.fk_paiement as mode_id, p.fk_user_creat as user_author_id, UNIX_TIMESTAMP(p.tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "paiement p";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "bank b ON p.fk_bank = b.rowid";
        $sql .= " WHERE p.tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'supplier_payments':
        // Fixed: fk_user_create doesn't exist, use fk_user_creat
        // Join with llx_bank to get the real bank account ID
        $sql = "SELECT p.rowid as id, p.ref, UNIX_TIMESTAMP(p.datep) as date_payment, p.amount, p.fk_bank as transaction_id, b.fk_account as bank_account_id, p.num_paiement, p.note, p.fk_paiement as mode_id, p.fk_user_author as user_author_id, UNIX_TIMESTAMP(p.tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "paiementfourn p";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "bank b ON p.fk_bank = b.rowid";
        $sql .= " WHERE p.tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'supplier_invoices':
        $sql = "SELECT rowid as id, ref, libelle as label, type, total_ht, total_ttc, tva as total_tva, fk_statut as statut, fk_soc, fk_projet as project_id, fk_user_author, fk_user_valid, UNIX_TIMESTAMP(datef) as date_invoice, UNIX_TIMESTAMP(date_lim_reglement) as date_lim_reglement, paye, UNIX_TIMESTAMP(datec) as datec, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "facture_fourn";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'supplier_invoice_lines':
        $sql = "SELECT d.rowid as id, d.fk_facture_fourn as parent_id, d.label, d.description, d.qty, d.tva_tx as vat_rate, d.pu_ht as subprice, d.total_ht, d.total_ttc, (d.total_ttc - d.total_ht) as total_tva, d.fk_product as product_id, prod.ref as product_ref, prod.label as product_label, UNIX_TIMESTAMP(p.tms) as tms, UNIX_TIMESTAMP(p.tms) as parent_tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "facture_fourn_det d";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "facture_fourn p ON d.fk_facture_fourn = p.rowid";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "product prod ON d.fk_product = prod.rowid";
        $sql .= " WHERE p.tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'links':
        // Fetches document links (e.g., proposal -> order -> invoice)
        // No TMS available, use rowid for incremental sync
        $sql = "SELECT rowid as id, sourcetype, sourceid, targettype, targetid";
        $sql .= " FROM " . MAIN_DB_PREFIX . "element_element";
        // Links table has no TMS column. We use ROWID for incremental sync.
        // If client sends a timestamp (large number), we interpret it as "full sync needed"
        // If client sends a small number, we interpret it as "last known rowid"
        // Threshold: 1 year in seconds (31536000) - anything above this is likely a timestamp
        if ($last_modified > 31536000) {
            // This is a timestamp, not a rowid - start fresh from rowid 0
            $last_modified = 0;
        }

        // Use rowid for incremental sync if last_modified is provided and > 0
        if ($last_modified > 0) {
            $sql .= " WHERE rowid > " . $db->escape($last_modified);
        }
        $sql .= " ORDER BY rowid ASC";
        break;

    case 'payment_invoice_links':
        // Links between Customer Payments and Invoices
        // Table: llx_paiement_facture
        // No TMS, use rowid for incremental sync similar to links
        $sql = "SELECT rowid as id, fk_paiement, fk_facture, amount";
        $sql .= " FROM " . MAIN_DB_PREFIX . "paiement_facture";

        if ($last_modified > 31536000) {
            $last_modified = 0;
        }
        if ($last_modified > 0) {
            $sql .= " WHERE rowid > " . $db->escape($last_modified);
        }
        $sql .= " ORDER BY rowid ASC";
        break;

    case 'supplier_payment_invoice_links':
        // Links between Supplier Payments and Supplier Invoices
        // Table: llx_paiementfourn_facturefourn
        // No TMS, use rowid for incremental sync
        $sql = "SELECT rowid as id, fk_paiementfourn, fk_facturefourn, amount";
        $sql .= " FROM " . MAIN_DB_PREFIX . "paiementfourn_facturefourn";

        if ($last_modified > 31536000) {
            $last_modified = 0;
        }
        if ($last_modified > 0) {
            $sql .= " WHERE rowid > " . $db->escape($last_modified);
        }
        $sql .= " ORDER BY rowid ASC";
        break;

    case 'expense_report_payments':
        // Payments for Expense Reports
        // Table: llx_payment_expensereport
        // Fallback to rowid if num_payment is empty
        // Join with llx_bank to get the real bank account ID (fk_account)
        $sql = "SELECT p.rowid as id, COALESCE(NULLIF(p.num_payment, ''), CONCAT('(PROV', p.rowid, ')')) as ref, p.fk_expensereport, UNIX_TIMESTAMP(p.datep) as date_payment, p.amount, p.fk_bank as transaction_id, b.fk_account as bank_account_id, p.fk_user_creat, UNIX_TIMESTAMP(p.tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "payment_expensereport p";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "bank b ON p.fk_bank = b.rowid";
        $sql .= " WHERE p.tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'expense_report_payment_links':
        // Links for Expense Report Payments (though table above has fk_expensereport, this seems to be the explicit link table)
        // Table: llx_paymentexpensereport_expensereport
        $sql = "SELECT rowid as id, fk_payment, fk_expensereport, amount";
        $sql .= " FROM " . MAIN_DB_PREFIX . "paymentexpensereport_expensereport";

        if ($last_modified > 31536000) {
            $last_modified = 0;
        }
        if ($last_modified > 0) {
            $sql .= " WHERE rowid > " . $db->escape($last_modified);
        }
        $sql .= " ORDER BY rowid ASC";
        break;

    case 'expense_report_lines':
        // Table: llx_expensereport_det
        // Joined with type fees and parent for TMS
        $sql = "SELECT d.rowid as id, d.fk_expensereport as parent_id, d.fk_c_type_fees as type_id, tf.code as type_code, tf.label as type_label, d.fk_projet as project_id, d.comments as description, d.qty, d.value_unit as unit_price, d.total_ht, d.total_ttc, d.total_tva, UNIX_TIMESTAMP(d.date) as date_expense, UNIX_TIMESTAMP(p.tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "expensereport_det d";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "expensereport p ON d.fk_expensereport = p.rowid";
        $sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "c_type_fees tf ON d.fk_c_type_fees = tf.id";
        $sql .= " WHERE p.tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'expense_types':
        // Dictionary Table: llx_c_type_fees
        // No TMS, use ID or fetch all if small
        $sql = "SELECT id, code, label, active";
        $sql .= " FROM " . MAIN_DB_PREFIX . "c_type_fees";
        $sql .= " WHERE active = 1";
        // Simple dictionary, sending all active usually fine, or filter by ID if needed.
        // But since no TMS, let's treat last_modified as ID check if small, or just send all.
        if ($last_modified > 0 && $last_modified < 31536000) {
            $sql .= " AND id > " . $db->escape($last_modified);
        }
        break;

    case 'vat_payments':
        // VAT Payments
        // Table: llx_payment_vat
        $sql = "SELECT rowid as id, num_paiement as ref, fk_tva, UNIX_TIMESTAMP(datep) as date_payment, amount, fk_bank, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "payment_vat";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'salary_payments':
        // Salary Payments
        // Table: llx_payment_salary
        $sql = "SELECT rowid as id, ref, num_payment, fk_user, UNIX_TIMESTAMP(datep) as date_payment, amount, salary, fk_bank, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "payment_salary";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'social_contribution_payments':
        // Social/Fiscal Charge Payments
        // Table: llx_paiementcharge
        $sql = "SELECT rowid as id, num_paiement as ref, fk_charge, UNIX_TIMESTAMP(datep) as date_payment, amount, fk_bank, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "paiementcharge";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'loan_payments':
        // Loan Payments
        // Table: llx_payment_loan
        $sql = "SELECT rowid as id, num_payment as ref, fk_loan, UNIX_TIMESTAMP(datep) as date_payment, amount_capital, amount_insurance, amount_interest, fk_bank, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "payment_loan";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    case 'various_payments':
        // Various/Miscellaneous Payments
        // Table: llx_payment_various
        $sql = "SELECT rowid as id, ref, num_payment, label, UNIX_TIMESTAMP(datep) as date_payment, amount, fk_bank, UNIX_TIMESTAMP(tms) as tms";
        $sql .= " FROM " . MAIN_DB_PREFIX . "payment_various";
        $sql .= " WHERE tms >= '" . $db->idate($last_modified) . "'";
        break;

    default:
        echo json_encode(["error" => "Unknown type parameter"]);
        exit;
}

// 5. Execution
if ($sql) {
    // Add ORDER BY for consistent pagination (oldest first)
    // Only add ORDER BY tms if not already ordered (links is ordered by rowid)
    if (strpos($sql, 'DESCRIBE') === false) {
        if (strpos($sql, 'ORDER BY') === false) {
            $sql .= " ORDER BY tms ASC";
        }

        // Apply limit and offset for pagination
        $sql .= " LIMIT " . $limit . " OFFSET " . $offset;
    }

    // DEBUG: Log SQL to file (REMOVED) - returning in response instead
    // if ($type === 'task_contacts') { ... }

    $res = $db->query($sql);
    if ($res) {
        while ($obj = $db->fetch_object($res)) {
            // Ensure UTF-8 for all string fields to prevent json_encode returning null
            foreach ($obj as $key => $value) {
                if (is_string($value) && !mb_check_encoding($value, 'UTF-8')) {
                    $obj->$key = mb_convert_encoding($value, 'UTF-8', 'ISO-8859-1');
                }
            }
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