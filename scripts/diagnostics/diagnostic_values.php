<?php
/**
 * Diagnostic Script - Value Sign Verification
 * 
 * This script fetches sample data from Dolibarr to help identify
 * if positive/negative values are inverted.
 * 
 * Usage: GET /diagnostic_values.php?DOLAPIKEY=your_api_key
 */

// Load Dolibarr environment
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

// Authentication
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
    die(json_encode(['error' => 'Missing API Key']));
}

// Validate API key
$foundUser = null;
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

if (!$foundUser) {
    http_response_code(401);
    die(json_encode(['error' => 'Invalid API Key']));
}

header('Content-Type: application/json; charset=utf-8');

$diagnostic = [
    'generated_at' => date('Y-m-d H:i:s'),
    'sections' => []
];

// 1. Customer Invoices (Faturas de Venda)
$sql = "SELECT rowid as id, ref, total_ht, total_ttc, total_tva, fk_statut as statut, paye 
        FROM " . MAIN_DB_PREFIX . "facture 
        ORDER BY datec DESC LIMIT 5";
$res = $db->query($sql);
$invoices = [];
if ($res) {
    while ($obj = $db->fetch_object($res)) {
        $invoices[] = [
            'id' => $obj->id,
            'ref' => $obj->ref,
            'total_ht' => (float) $obj->total_ht,
            'total_ttc' => (float) $obj->total_ttc,
            'total_tva' => (float) $obj->total_tva,
            'statut' => $obj->statut,
            'paye' => $obj->paye,
            '_sign_check' => (float) $obj->total_ttc >= 0 ? 'POSITIVE ✓' : 'NEGATIVE ⚠️'
        ];
    }
}
$diagnostic['sections']['customer_invoices'] = [
    'description' => 'Faturas de Venda (devem ser POSITIVAS)',
    'expected_sign' => 'POSITIVE',
    'sample_count' => count($invoices),
    'data' => $invoices
];

// 2. Supplier Invoices (Faturas de Fornecedor)
$sql = "SELECT rowid as id, ref, total_ht, total_ttc, fk_statut as statut, paye 
        FROM " . MAIN_DB_PREFIX . "facture_fourn 
        ORDER BY datec DESC LIMIT 5";
$res = $db->query($sql);
$supplierInvoices = [];
if ($res) {
    while ($obj = $db->fetch_object($res)) {
        $supplierInvoices[] = [
            'id' => $obj->id,
            'ref' => $obj->ref,
            'total_ht' => (float) $obj->total_ht,
            'total_ttc' => (float) $obj->total_ttc,
            'statut' => $obj->statut,
            'paye' => $obj->paye,
            '_sign_check' => (float) $obj->total_ttc >= 0 ? 'POSITIVE ✓' : 'NEGATIVE ⚠️'
        ];
    }
}
$diagnostic['sections']['supplier_invoices'] = [
    'description' => 'Faturas de Fornecedor (normalmente POSITIVAS no Dolibarr)',
    'expected_sign' => 'POSITIVE',
    'sample_count' => count($supplierInvoices),
    'data' => $supplierInvoices
];

// 3. Bank Accounts with calculated balance
$sql = "SELECT ba.rowid as id, ba.ref, ba.label, ba.currency_code,
        COALESCE((SELECT SUM(b.amount) FROM " . MAIN_DB_PREFIX . "bank b WHERE b.fk_account = ba.rowid), 0) as solde_calculado
        FROM " . MAIN_DB_PREFIX . "bank_account ba 
        WHERE ba.clos = 0
        ORDER BY ba.rowid LIMIT 5";
$res = $db->query($sql);
$bankAccounts = [];
if ($res) {
    while ($obj = $db->fetch_object($res)) {
        $bankAccounts[] = [
            'id' => $obj->id,
            'ref' => $obj->ref,
            'label' => $obj->label,
            'currency' => $obj->currency_code,
            'solde_calculado' => (float) $obj->solde_calculado,
            '_sign_analysis' => (float) $obj->solde_calculado >= 0 ? 'POSITIVE' : 'NEGATIVE'
        ];
    }
}
$diagnostic['sections']['bank_accounts'] = [
    'description' => 'Contas Bancárias (saldo = soma das transações)',
    'note' => 'Saldo positivo = mais entradas que saídas',
    'sample_count' => count($bankAccounts),
    'data' => $bankAccounts
];

// 4. Bank Transactions (most recent)
$sql = "SELECT b.rowid as id, b.dateo, b.amount, b.label, ba.label as account_label,
        CASE WHEN b.amount > 0 THEN 'CREDIT (+)' ELSE 'DEBIT (-)' END as type
        FROM " . MAIN_DB_PREFIX . "bank b
        LEFT JOIN " . MAIN_DB_PREFIX . "bank_account ba ON b.fk_account = ba.rowid
        ORDER BY b.dateo DESC, b.rowid DESC LIMIT 10";
$res = $db->query($sql);
$bankLines = [];
if ($res) {
    while ($obj = $db->fetch_object($res)) {
        $bankLines[] = [
            'id' => $obj->id,
            'date' => $obj->dateo,
            'amount' => (float) $obj->amount,
            'label' => $obj->label,
            'account' => $obj->account_label,
            'type' => $obj->type,
            '_raw_sign' => (float) $obj->amount >= 0 ? 'POSITIVE' : 'NEGATIVE'
        ];
    }
}
$diagnostic['sections']['bank_transactions'] = [
    'description' => 'Transações Bancárias Recentes',
    'note' => 'CREDIT (+) = entrada de dinheiro, DEBIT (-) = saída de dinheiro',
    'sample_count' => count($bankLines),
    'data' => $bankLines
];

// 5. Payments (received from customers)
$sql = "SELECT rowid as id, ref, datep, amount 
        FROM " . MAIN_DB_PREFIX . "paiement 
        ORDER BY datep DESC LIMIT 5";
$res = $db->query($sql);
$payments = [];
if ($res) {
    while ($obj = $db->fetch_object($res)) {
        $payments[] = [
            'id' => $obj->id,
            'ref' => $obj->ref,
            'date' => $obj->datep,
            'amount' => (float) $obj->amount,
            '_sign_check' => (float) $obj->amount >= 0 ? 'POSITIVE ✓' : 'NEGATIVE ⚠️'
        ];
    }
}
$diagnostic['sections']['customer_payments'] = [
    'description' => 'Pagamentos Recebidos de Clientes (devem ser POSITIVOS)',
    'expected_sign' => 'POSITIVE',
    'sample_count' => count($payments),
    'data' => $payments
];

// 6. Supplier Payments (paid to suppliers)
$sql = "SELECT rowid as id, ref, datep, amount 
        FROM " . MAIN_DB_PREFIX . "paiementfourn 
        ORDER BY datep DESC LIMIT 5";
$res = $db->query($sql);
$supplierPayments = [];
if ($res) {
    while ($obj = $db->fetch_object($res)) {
        $supplierPayments[] = [
            'id' => $obj->id,
            'ref' => $obj->ref,
            'date' => $obj->datep,
            'amount' => (float) $obj->amount,
            '_sign_check' => (float) $obj->amount >= 0 ? 'POSITIVE ✓' : 'NEGATIVE ⚠️'
        ];
    }
}
$diagnostic['sections']['supplier_payments'] = [
    'description' => 'Pagamentos a Fornecedores (normalmente POSITIVOS no registro)',
    'expected_sign' => 'POSITIVE',
    'sample_count' => count($supplierPayments),
    'data' => $supplierPayments
];

// Summary
$diagnostic['summary'] = [
    'instructions' => 'Compare estes valores com a interface do Dolibarr para identificar inversões.',
    'what_to_check' => [
        '1. Faturas de venda devem ter valores positivos',
        '2. Transações bancárias: + para entradas, - para saídas',
        '3. Saldo bancário deve corresponder ao que você vê no Dolibarr',
        '4. Pagamentos recebidos devem ser positivos'
    ]
];

echo json_encode($diagnostic, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
?>