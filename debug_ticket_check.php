<?php
define('NOCSRFCHECK', 1);
define('NOTOKENRENEWAL', 1);
define('NOREQUIREMENU', '1');
define('NOREQUIREHTML', '1');
require 'main.inc.php';

header('Content-Type: text/plain');

echo "--- Checking Table: " . MAIN_DB_PREFIX . "ticket_extrafields ---\n";
$sql_check = "DESCRIBE " . MAIN_DB_PREFIX . "ticket_extrafields";
$res_check = $db->query($sql_check);
if ($res_check) {
    while ($row = $db->fetch_object($res_check)) {
        echo $row->Field . " (" . $row->Type . ")\n";
    }
} else {
    echo "Error describing table: " . $db->lasterror() . "\n";
    echo "Trying llx_ticket_customfields maybe?\n";
}

echo "\n--- Testing Query ---\n";
// The query from custom_sync.php
$sql = "SELECT t.rowid as id, t.ref, t.track_id, t.subject, t.message, t.type_code, t.category_code, t.severity_code, t.fk_statut as statut, t.progress, t.fk_soc as socid, t.fk_project as project_id, t.fk_user_assign, t.fk_user_create, t.fk_user_close, t.origin_email, UNIX_TIMESTAMP(t.datec) as datec, UNIX_TIMESTAMP(t.tms) as tms,";
$sql .= " te.resumo_da_conversa as options_resumo_da_conversa, te.resumo_vaga as options_resumo_vaga, te.quantidade_publico_evento as options_quantidade_publico_evento, te.valor_budget as options_valor_budget, te.cf_session_id as options_cf_session_id";
$sql .= " FROM " . MAIN_DB_PREFIX . "ticket t";
$sql .= " LEFT JOIN " . MAIN_DB_PREFIX . "ticket_extrafields te ON t.rowid = te.fk_object";
$sql .= " WHERE t.tms >= 0 LIMIT 1";

echo "Query: " . $sql . "\n";
$res = $db->query($sql);
if ($res) {
    echo "Query Success! Rows: " . $db->num_rows($res) . "\n";
    if ($obj = $db->fetch_object($res)) {
        print_r($obj);
    }
} else {
    echo "Query Failed: " . $db->lasterror() . "\n";
}
?>