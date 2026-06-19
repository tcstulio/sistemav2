<?php
/**
 * One-off / utilitário (sistemav2 #293): durabilidade do estado da delegação no Dolibarr.
 *
 *  - action=setup : cria (idempotente) o extrafield 'delegation_state' (tipo text/JSON) na
 *                   tarefa (projet_task). Resolve o bloqueio dolibarr#76. Roda 1x.
 *  - action=list  : devolve { data: [{task_id, delegation_state}] } com os estados persistidos,
 *                   para o backend reidratar o cache local (delegation_store.json) após perda/reset.
 *
 * Depois do setup, a ESCRITA é feita pela REST nativa do Dolibarr (PUT /projects/tasks/{id} com
 * array_options.options_delegation_state) — este arquivo não escreve estado, só cria o campo e lê.
 *
 * Admin-only · idempotente. Coloque na raiz do Dolibarr (mesmo lugar do custom_sync.php).
 * Uso:
 *   GET /custom_delegation.php?action=setup&DOLAPIKEY=<chave_admin>
 *   GET /custom_delegation.php?action=list&DOLAPIKEY=<chave_admin>
 */

if (!defined("NOCSRFCHECK")) define("NOCSRFCHECK", 1);
if (!defined("NOTOKENRENEWAL")) define("NOTOKENRENEWAL", 1);
if (!defined('NOREQUIREMENU')) define('NOREQUIREMENU', '1');
if (!defined('NOREQUIREHTML')) define('NOREQUIREHTML', '1');
if (!defined('NOREQUIREAJAX')) define('NOREQUIREAJAX', '1');
if (!defined('NOLOGIN')) define('NOLOGIN', '1');

require 'main.inc.php';

header('Content-Type: application/json');

// --- Auth (mesmo padrão do custom_sync.php / custom_chat_systemauto.php) ---
$apikey = GETPOST('DOLAPIKEY', 'none');
if (empty($apikey)) {
    $headers = function_exists('apache_request_headers') ? apache_request_headers() : array();
    if (!empty($headers['DOLAPIKEY'])) $apikey = $headers['DOLAPIKEY'];
}
$apikey = trim($apikey);
if (empty($apikey)) { http_response_code(401); print json_encode(['error' => 'Missing API Key']); exit; }

$foundUser = null;
$res_users = $db->query("SELECT rowid FROM " . MAIN_DB_PREFIX . "user WHERE statut = 1");
if ($res_users) {
    while ($u = $db->fetch_object($res_users)) {
        $tmp = new User($db);
        $tmp->fetch($u->rowid);
        if ($tmp->api_key === $apikey) { $foundUser = $tmp; break; }
    }
}
if (!$foundUser) { http_response_code(401); print json_encode(['error' => 'Invalid API Key']); exit; }
if (empty($foundUser->admin)) { http_response_code(403); print json_encode(['error' => 'Admin only']); exit; }

$action = GETPOST('action', 'aZ09');
if (empty($action)) $action = 'list';
$elementtype = 'projet_task';
$attrname = 'delegation_state';
$tbl = MAIN_DB_PREFIX . 'projet_task_extrafields';

if ($action === 'setup') {
    require_once DOL_DOCUMENT_ROOT . '/core/class/extrafields.class.php';
    $extrafields = new ExtraFields($db);

    // Idempotente: se a definição já existe, não recria.
    $exists = false;
    $chk = $db->query("SELECT rowid FROM " . MAIN_DB_PREFIX . "extrafields WHERE name = '" . $db->escape($attrname) . "' AND elementtype = '" . $db->escape($elementtype) . "'");
    if ($chk && $db->num_rows($chk) > 0) $exists = true;
    if ($exists) {
        print json_encode(['success' => true, 'applied' => false, 'message' => 'extrafield ja existe']);
        exit;
    }

    // addExtraField($attrname,$label,$type,$pos,$size,$elementtype,$unique,$required,$default,$param,$alwayseditable,$perms,$list,$help,...)
    $res = $extrafields->addExtraField(
        $attrname,
        'Delegation State (sistemav2)',
        'text',
        100,
        '',
        $elementtype,
        0,
        0,
        '',
        '',
        1,
        '',
        '0',
        'Estado do ciclo de delegacao (JSON), espelhado pelo sistemav2 #293.'
    );
    if ($res > 0) {
        print json_encode(['success' => true, 'applied' => true, 'message' => 'extrafield criado']);
    } else {
        http_response_code(500);
        print json_encode(['success' => false, 'error' => $extrafields->error ?: 'addExtraField falhou']);
    }
    exit;
}

// action=list (default): estados persistidos para reidratacao do cache local.
$out = array();
// A coluna so existe apos o setup; protege contra erro se ainda nao criada.
$colchk = $db->query("SHOW COLUMNS FROM " . $tbl . " LIKE '" . $db->escape($attrname) . "'");
if ($colchk && $db->num_rows($colchk) > 0) {
    $r = $db->query("SELECT fk_object as task_id, " . $attrname . " as delegation_state FROM " . $tbl . " WHERE " . $attrname . " IS NOT NULL AND " . $attrname . " <> ''");
    if ($r) {
        while ($o = $db->fetch_object($r)) {
            $out[] = ['task_id' => $o->task_id, 'delegation_state' => $o->delegation_state];
        }
    }
}
print json_encode(['success' => true, 'data' => $out], JSON_UNESCAPED_UNICODE);
