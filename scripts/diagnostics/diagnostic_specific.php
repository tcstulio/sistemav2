<?php
/**
 * Diagnostic - Specific Invoice Check
 */
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

$apikey = GETPOST('DOLAPIKEY', 'none');
if (empty($apikey)) {
    $headers = apache_request_headers();
    if (!empty($headers['DOLAPIKEY']))
        $apikey = $headers['DOLAPIKEY'];
}
$apikey = trim($apikey);

if (empty($apikey)) {
    http_response_code(401);
    die(json_encode(['error' => 'Missing API Key']));
}

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

$result = [];

// 1. Buscar a fatura de SAÍDA (Supplier Invoice) SI2506-1824
$sql = "SELECT rowid as id, ref, total_ht, total_ttc, total_tva, fk_statut as statut, paye, fk_soc 
        FROM " . MAIN_DB_PREFIX . "facture_fourn WHERE ref = 'SI2506-1824'";
$res = $db->query($sql);
if ($res && $obj = $db->fetch_object($res)) {
    $result['supplier_invoice_SI2506-1824'] = [
        'type' => 'FATURA DE FORNECEDOR (SAÍDA/DESPESA)',
        'id' => $obj->id,
        'ref' => $obj->ref,
        'total_ht' => (float) $obj->total_ht,
        'total_ttc' => (float) $obj->total_ttc,
        'statut' => $obj->statut,
        'paye' => $obj->paye,
        'sign_in_db' => (float) $obj->total_ttc >= 0 ? 'POSITIVE' : 'NEGATIVE',
        'expected_behavior' => 'Valor armazenado POSITIVO, mas representa uma DESPESA (saída de dinheiro)'
    ];
}

// 2. Buscar a fatura de ENTRADA (Customer Invoice) IN2503-0171
$sql = "SELECT rowid as id, ref, total_ht, total_ttc, total_tva, fk_statut as statut, paye, fk_soc 
        FROM " . MAIN_DB_PREFIX . "facture WHERE ref = 'IN2503-0171'";
$res = $db->query($sql);
if ($res && $obj = $db->fetch_object($res)) {
    $result['customer_invoice_IN2503-0171'] = [
        'type' => 'FATURA DE CLIENTE (ENTRADA/RECEITA)',
        'id' => $obj->id,
        'ref' => $obj->ref,
        'total_ht' => (float) $obj->total_ht,
        'total_ttc' => (float) $obj->total_ttc,
        'statut' => $obj->statut,
        'paye' => $obj->paye,
        'sign_in_db' => (float) $obj->total_ttc >= 0 ? 'POSITIVE' : 'NEGATIVE',
        'expected_behavior' => 'Valor armazenado POSITIVO, representa uma RECEITA (entrada de dinheiro)'
    ];
}

// 3. Conta Inter - Saldo detalhado
$sql = "SELECT ba.rowid as id, ba.label,
        (SELECT SUM(b.amount) FROM " . MAIN_DB_PREFIX . "bank b WHERE b.fk_account = ba.rowid) as saldo_total,
        (SELECT SUM(b.amount) FROM " . MAIN_DB_PREFIX . "bank b WHERE b.fk_account = ba.rowid AND b.amount > 0) as total_entradas,
        (SELECT SUM(b.amount) FROM " . MAIN_DB_PREFIX . "bank b WHERE b.fk_account = ba.rowid AND b.amount < 0) as total_saidas,
        (SELECT COUNT(*) FROM " . MAIN_DB_PREFIX . "bank b WHERE b.fk_account = ba.rowid AND b.amount > 0) as qtd_entradas,
        (SELECT COUNT(*) FROM " . MAIN_DB_PREFIX . "bank b WHERE b.fk_account = ba.rowid AND b.amount < 0) as qtd_saidas
        FROM " . MAIN_DB_PREFIX . "bank_account ba WHERE ba.ref = 'Inter'";
$res = $db->query($sql);
if ($res && $obj = $db->fetch_object($res)) {
    $result['bank_inter_detail'] = [
        'account' => $obj->label,
        'saldo_calculado' => (float) $obj->saldo_total,
        'total_entradas_positivas' => (float) $obj->total_entradas,
        'total_saidas_negativas' => (float) $obj->total_saidas,
        'quantidade_entradas' => (int) $obj->qtd_entradas,
        'quantidade_saidas' => (int) $obj->qtd_saidas,
        'dolibarr_web_saldo' => '-10.243,82 (informado pelo usuário)'
    ];
}

// 4. Últimas entradas (créditos) na conta Inter
$sql = "SELECT b.rowid, b.dateo, b.amount, b.label 
        FROM " . MAIN_DB_PREFIX . "bank b
        JOIN " . MAIN_DB_PREFIX . "bank_account ba ON b.fk_account = ba.rowid
        WHERE ba.ref = 'Inter' AND b.amount > 0
        ORDER BY b.dateo DESC LIMIT 5";
$res = $db->query($sql);
$entradas = [];
while ($res && $obj = $db->fetch_object($res)) {
    $entradas[] = ['date' => $obj->dateo, 'amount' => (float) $obj->amount, 'label' => $obj->label];
}
$result['ultimas_entradas_inter'] = $entradas;

// 5. Verificar se pagamentos de clientes geram transações bancárias
$sql = "SELECT p.ref as payment_ref, p.amount as payment_amount, 
        b.rowid as bank_line_id, b.amount as bank_amount, ba.label as bank_account
        FROM " . MAIN_DB_PREFIX . "paiement p
        LEFT JOIN " . MAIN_DB_PREFIX . "bank b ON p.fk_bank = b.rowid
        LEFT JOIN " . MAIN_DB_PREFIX . "bank_account ba ON b.fk_account = ba.rowid
        ORDER BY p.datep DESC LIMIT 5";
$res = $db->query($sql);
$paymentLinks = [];
while ($res && $obj = $db->fetch_object($res)) {
    $paymentLinks[] = [
        'payment_ref' => $obj->payment_ref,
        'payment_amount' => (float) $obj->payment_amount,
        'bank_line_id' => $obj->bank_line_id,
        'bank_amount' => $obj->bank_amount !== null ? (float) $obj->bank_amount : null,
        'bank_account' => $obj->bank_account,
        'linked' => $obj->bank_line_id ? 'YES' : 'NO'
    ];
}
$result['payment_bank_link'] = [
    'description' => 'Verifica se pagamentos de clientes estão vinculados a transações bancárias',
    'data' => $paymentLinks
];

echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
?>