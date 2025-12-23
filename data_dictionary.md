# Data Dictionary & Correlation Analysis
Generated: 2025-12-23T19:40:00Z

## bank_accounts (10 rows)
- **Primary Key**: `id`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 2 |
| **ref** | TEXT | Inter |
| **label** | TEXT | Inter |
| **bank** | TEXT |  |
| **code_banque** | TEXT |  |
| **code_guichet** | TEXT |  |
| **number** | TEXT |  |
| **cle_rib** | TEXT |  |
| **bic** | TEXT |  |
| **domiciliation** | TEXT |  |
| **owner_name** | TEXT | Carvalhos |
| **owner_address** | TEXT |  |
| **currency_code** | TEXT | BRL |
| **status** | TEXT | 0 |
| **datec** | TEXT | 1722471635 |
| **tms** | TEXT | 1722471635 |
| **solde** | TEXT | -15853.05000000 |

## bank_lines (3081 rows)
- **Primary Key**: `id`
- **Potential Links**: `fk_account, fk_type`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 1 |
| **date_operation** | TEXT | 1722222000 |
| **date_value** | TEXT | 1722222000 |
| **amount** | TEXT | 0.00000000 |
| **label** | TEXT | (InitialBankBalance) |
| **fk_account** | TEXT | 1 |
| **num_releve** | TEXT | null |
| **fk_type** | TEXT | SOLD |
| **tms** | TEXT | 1722272004 |

## candidates (697 rows)
- **Primary Key**: `id`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 8 |
| **firstname** | TEXT | 11961249506 |
| **lastname** | TEXT | Jéssica de Oliveira Silva |
| **email** | TEXT | jessicaoliveirasilva450@gmail.com |
| **tms** | TEXT | 1749749948 |
| **datec** | TEXT | 1749749948 |

## boms (0 rows)
- **Primary Key**: `id`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT |  |
| **ref** | TEXT |  |
| **label** | TEXT |  |
| **description** | TEXT |  |
| **duration** | TEXT |  |
| **efficiency** | TEXT |  |
| **datec** | TEXT |  |
| **tms** | TEXT |  |

## bom_lines (New)
- **Primary Key**: `id`
- **Potential Links**: `parent_id (fk_bom), product_id`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT |  |
| **parent_id** | TEXT |  |
| **product_id** | TEXT |  |
| **qty** | TEXT |  |
| **efficiency** | TEXT |  |

## categories (141 rows)
- **Primary Key**: `id`
- **Potential Links**: `parent_id`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 3 |
| **label** | TEXT | Espaços |
| **type** | TEXT | 1 |
| **description** | TEXT |  |
| **parent_id** | TEXT | null |
| **tms** | TEXT | 1722095417 |

## contacts (120 rows)
- **Primary Key**: `id`
- **Potential Links**: `fk_soc, fk_user_creat`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 3 |
| **lastname** | TEXT | Artur Santoro |
| **firstname** | TEXT |  |
| **email** | TEXT |  |
| **phone_work** | TEXT | 11999774671 |
| **phone_personal** | TEXT |  |
| **phone_mobile** | TEXT |  |
| **position** | TEXT | Dono |
| **fk_soc** | TEXT | 51 |
| **fk_user_creat** | TEXT | 4 |
| **statut** | TEXT | 1 |
| **datec** | TEXT | 1722448663 |
| **tms** | TEXT | 1722448663 |

## events (470 rows)
- **Primary Key**: `id`
- **Potential Links**: `fk_user_author, socid, project_id, fk_element`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 564 |
| **ref** | TEXT | 564 |
| **label** | TEXT | Senha modificada em Dolibarr |
| **description** | TEXT | Senha modificada em Dolibarr |
| **type_code** | TEXT | AC_USER_NEW_PASSWORD |
| **date_start** | TEXT | 2025-01-10 19:45:44 |
| **date_end** | TEXT | 2025-01-10 19:45:44 |
| **percentage** | TEXT | -1 |
| **fk_user_author** | TEXT | 5 |
| **socid** | TEXT | null |
| **project_id** | TEXT | null |
| **location** | TEXT |  |
| **elementtype** | TEXT | user |
| **fk_element** | TEXT | 19 |
| **fulldayevent** | TEXT | 0 |
| **priority** | TEXT | 0 |
| **transparency** | TEXT | 0 |
| **datec** | TEXT | 1736549144 |
| **tms** | TEXT | 1736549144 |

## expense_reports (677 rows)
- **Primary Key**: `id`
- **Potential Links**: `fk_user_author`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 2 |
| **ref** | TEXT | ER2501-0001 |
| **total_ttc** | TEXT | 70.00000000 |
| **date_debut** | TEXT | 1724036400 |
| **date_fin** | TEXT | 1724036400 |
| **statut** | TEXT | 6 |
| **fk_user_author** | TEXT | 22 |
| **tms** | TEXT | 1738251437 |

## interventions (14 rows)
- **Primary Key**: `id`
- **Potential Links**: `socid, project_id`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 2 |
| **ref** | TEXT | FI2510-0002 |
| **socid** | TEXT | 618 |
| **project_id** | TEXT | 499 |
| **date_creation** | TEXT | 1761059349 |
| **tms** | TEXT | 1761059499 |
| **description** | TEXT | null |
| **statut** | TEXT | 1 |

## intervention_lines (New)
- **Primary Key**: `id`
- **Potential Links**: `parent_id (fk_fichinter)`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT |  |
| **parent_id** | TEXT |  |
| **description** | TEXT |  |
| **qty** | TEXT |  |
| **tms** | TEXT |  |

## invoice_lines (871 rows)
- **Primary Key**: `id`
- **Potential Links**: `parent_id, product_id`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 13 |
| **parent_id** | TEXT | 5 |
| **label** | TEXT | null |
| **description** | TEXT |  |
| **type** | TEXT | 1 |
| **qty** | TEXT | 1 |
| **vat_rate** | TEXT | 0.0000 |
| **subprice** | TEXT | 2800.00000000 |
| **total_ht** | TEXT | 2800.00000000 |
| **total_ttc** | TEXT | 2800.00000000 |
| **total_tva** | TEXT | 0.00000000 |
| **product_id** | TEXT | 1274 |

## invoices (360 rows)
- **Primary Key**: `id`
- **Potential Links**: `fk_soc, project_id, fk_user_author`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 5 |
| **ref** | TEXT | IN2408-0002 |
| **total_ht** | TEXT | 10000.00000000 |
| **total_ttc** | TEXT | 10000.00000000 |
| **total_tva** | TEXT | 0.00000000 |
| **statut** | TEXT | 2 |
| **fk_soc** | TEXT | 35 |
| **project_id** | TEXT | 13 |
| **fk_user_author** | TEXT | 6 |
| **date_invoice** | TEXT | 1722999600 |
| **date_lim_reglement** | TEXT | 1723086000 |
| **paye** | TEXT | 1 |
| **datec** | TEXT | 1723062746 |
| **tms** | TEXT | 1723063033 |

## job_positions (80 rows)
- **Primary Key**: `id`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 37 |
| **ref** | TEXT | JOB2508-0031 |
| **label** | TEXT | Bombeiro Civil Evento |
| **qty** | TEXT | 1 |
| **status** | TEXT | 3 |
| **description** | TEXT | &nbsp;<br />
Vaga para Bombeiro Civil em monta... |
| **datec** | TEXT | 1754091853 |
| **tms** | TEXT | 1758554561 |

## leave_requests (0 rows)
- **Primary Key**: `id`
- **Potential Links**: `fk_user, fk_type`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT |  |
| **type** | TEXT |  |
| **halfday** | TEXT |  |
| **date_debut** | TEXT |  |
| **date_fin** | TEXT |  |
| **description** | TEXT |  |
| **fk_user** | TEXT |  |
| **statut** | TEXT |  |
| **datec** | TEXT |  |
| **tms** | TEXT |  |

## links (0 rows)
- **Primary Key**: `id`
- **Potential Links**: `sourceid, targetid`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT |  |
| **sourcetype** | TEXT | propal |
| **sourceid** | TEXT | 12 |
| **targettype** | TEXT | commande |
| **targetid** | TEXT | 33 |

## manufacturing_orders (0 rows)
- **Primary Key**: `id`
- **Potential Links**: `fk_product`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT |  |
| **ref** | TEXT |  |
| **label** | TEXT |  |
| **status** | TEXT |  |
| **product_to_produce_id** | TEXT |  |
| **qty** | TEXT |  |
| **date_start** | TEXT |  |
| **date_end** | TEXT |  |
| **datec** | TEXT |  |
| **tms** | TEXT |  |

## order_lines (571 rows)
- **Primary Key**: `id`
- **Potential Links**: `parent_id, product_id`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 91 |
| **parent_id** | TEXT | 33 |
| **label** | TEXT | null |
| **description** | TEXT |  |
| **type** | TEXT | 1 |
| **qty** | TEXT | 1 |
| **vat_rate** | TEXT | 0.0000 |
| **subprice** | TEXT | 11200.00000000 |
| **total_ht** | TEXT | 11200.00000000 |
| **total_ttc** | TEXT | 11200.00000000 |
| **total_tva** | TEXT | 0.00000000 |
| **product_id** | TEXT | 1277 |

## orders (79 rows)
- **Primary Key**: `id`
- **Potential Links**: `fk_soc, project_id, fk_user_author`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 33 |
| **ref** | TEXT | SO2408-0014 |
| **total_ht** | TEXT | 29000.00000000 |
| **total_ttc** | TEXT | 29000.00000000 |
| **total_tva** | TEXT | 0.00000000 |
| **statut** | TEXT | 0 |
| **fk_soc** | TEXT | 88 |
| **project_id** | TEXT | 43 |
| **fk_user_author** | TEXT | 4 |
| **date_commande** | TEXT | 1724468400 |
| **datec** | TEXT | 1724533292 |
| **tms** | TEXT | 1726024207 |

## payments (338 rows)
- **Primary Key**: `id`
- **Potential Links**: `fk_bank`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 1 |
| **ref** | TEXT | PAY2407-0001 |
| **date_payment** | TEXT | 1722438000 |
| **amount** | TEXT | 10000.00000000 |
| **fk_bank** | TEXT | 4 |
| **tms** | TEXT | 1723063033 |

## products (961 rows)
- **Primary Key**: `id`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 1375 |
| **ref** | TEXT | 00014 |
| **label** | TEXT | Moving Head AH |
| **description** | TEXT |  |
| **type** | TEXT | 0 |
| **price** | TEXT | 0.00000000 |
| **stock** | TEXT | null |
| **datec** | TEXT | 1737565153 |
| **tms** | TEXT | 1740056370 |

## projects (381 rows)
- **Primary Key**: `id`
- **Potential Links**: `socid, fk_user_creat, parent_id (fk_project)`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 121 |
| **ref** | TEXT | PJ2502-0092 |
| **title** | TEXT | Gororoba + Bloco do Tchelo |
| **statut** | TEXT | 1 |
| **socid** | TEXT | 35 |
| **fk_user_creat** | TEXT | 4 |
| **parent_id** | TEXT | 90 |
| **datec** | TEXT | 1739286573 |
| **date_start** | TEXT | 1738897200 |
| **date_end** | TEXT | 1738983600 |
| **budget_amount** | TEXT | null |
| **tms** | TEXT | 1739304522 |
| **progress** | TEXT | 0.0000 |

## proposal_lines (1486 rows)
- **Primary Key**: `id`
- **Potential Links**: `parent_id, product_id`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 27 |
| **parent_id** | TEXT | 12 |
| **label** | TEXT | null |
| **description** | TEXT | Hall, Fum&oacute;dromo, Pista, Lounge e Mezanin... |
| **type** | TEXT | 1 |
| **qty** | TEXT | 3 |
| **vat_rate** | TEXT | 0.0000 |
| **subprice** | TEXT | 9000.00000000 |
| **total_ht** | TEXT | 27000.00000000 |
| **total_ttc** | TEXT | 27000.00000000 |
| **total_tva** | TEXT | 0.00000000 |
| **product_id** | TEXT | 2062 |

## proposals (146 rows)
- **Primary Key**: `id`
- **Potential Links**: `fk_soc, project_id, fk_user_author`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 12 |
| **ref** | TEXT | PR2504-0001 |
| **total_ht** | TEXT | 792600.00000000 |
| **total_ttc** | TEXT | 792600.00000000 |
| **total_tva** | TEXT | 0.00000000 |
| **statut** | TEXT | 0 |
| **fk_soc** | TEXT | 552 |
| **project_id** | TEXT | 193 |
| **fk_user_author** | TEXT | 5 |
| **datec** | TEXT | 1744143618 |
| **tms** | TEXT | 1744222069 |

## shipments (0 rows)
- **Primary Key**: `id`
- **Potential Links**: `fk_soc`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT |  |
| **ref** | TEXT |  |
| **fk_soc** | TEXT |  |
| **date_creation** | TEXT |  |
| **date_delivery** | TEXT |  |
| **status** | TEXT |  |
| **tracking_number** | TEXT |  |
| **tms** | TEXT |  |

## shipment_lines (New)
- **Primary Key**: `id`
- **Potential Links**: `parent_id (fk_expedition), product_id`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT |  |
| **parent_id** | TEXT |  |
| **label** | TEXT |  |
| **description** | TEXT |  |
| **qty** | TEXT |  |
| **product_id** | TEXT |  |

## stock_movements (1780 rows)
- **Primary Key**: `id`
- **Potential Links**: `fk_product, fk_entrepot`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 1 |
| **datem** | TEXT | 1722270641 |
| **fk_product** | TEXT | 10 |
| **fk_entrepot** | TEXT | 1 |
| **value** | TEXT | 1 |
| **type_mouvement** | TEXT | 0 |
| **label** | TEXT | Inventario 1Entrada |
| **tms** | TEXT | 1722270641 |

## supplier_invoices (1902 rows)
- **Primary Key**: `id`
- **Potential Links**: `fk_soc`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 7 |
| **ref** | TEXT | SI2408-0002 |
| **fk_soc** | TEXT | 13 |
| **date_invoice** | TEXT | 1722826800 |
| **total_ttc** | TEXT | 1020.00000000 |
| **statut** | TEXT | 2 |
| **paye** | TEXT | 1 |
| **datec** | TEXT | 1722898268 |
| **tms** | TEXT | 1723072429 |

## supplier_invoice_lines (New)
- **Primary Key**: `id`
- **Potential Links**: `parent_id (fk_facture_fourn), product_id`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT |  |
| **parent_id** | TEXT |  |
| **label** | TEXT |  |
| **description** | TEXT |  |
| **qty** | TEXT |  |
| **vat_rate** | TEXT |  |
| **subprice** | TEXT |  |
| **total_ht** | TEXT |  |
| **total_ttc** | TEXT |  |
| **total_tva** | TEXT |  |
| **product_id** | TEXT |  |

## supplier_orders (16 rows)
- **Primary Key**: `id`
- **Potential Links**: `fk_soc`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 3 |
| **ref** | TEXT | PO2510-0002 |
| **fk_soc** | TEXT | 210 |
| **date_creation** | TEXT | 1760766679 |
| **date_livraison** | TEXT | 1760756400 |
| **total_ttc** | TEXT | 3220.96000000 |
| **statut** | TEXT | 5 |
| **tms** | TEXT | 1760767839 |

## supplier_order_lines (New)
- **Primary Key**: `id`
- **Potential Links**: `parent_id (fk_commande), product_id`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT |  |
| **parent_id** | TEXT |  |
| **label** | TEXT |  |
| **description** | TEXT |  |
| **qty** | TEXT |  |
| **vat_rate** | TEXT |  |
| **subprice** | TEXT |  |
| **total_ht** | TEXT |  |
| **total_ttc** | TEXT |  |
| **total_tva** | TEXT |  |
| **product_id** | TEXT |  |

## supplier_payments (1956 rows)
- **Primary Key**: `id`
- **Potential Links**: `fk_bank`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 1 |
| **ref** | TEXT | SPAY2408-0001 |
| **date_payment** | TEXT | 1723042800 |
| **amount** | TEXT | 1020.00000000 |
| **fk_bank** | TEXT | 8 |
| **tms** | TEXT | 1723072429 |

## suppliers (451 rows)
- **Primary Key**: `id`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 18 |
| **name** | TEXT | Michele |
| **name_alias** | TEXT | Filha dona Val |
| **code_client** | TEXT | null |
| **code_fournisseur** | TEXT | SU2407-00008 |
| **email** | TEXT | null |
| **phone** | TEXT | 11954997498 |
| **client** | TEXT | 0 |
| **fournisseur** | TEXT | 1 |
| **status** | TEXT | 1 |
| **tms** | TEXT | 1722295051 |
| **datec** | TEXT | 1722295051 |

## system_logs (28330 rows)
- **Primary Key**: `id`
- **Potential Links**: `fk_user_author, socid, project_id, fk_element`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 12 |
| **ref** | TEXT | 12 |
| **label** | TEXT | Projeto PJ2412-0067 modificado |
| **description** | TEXT | Projeto PJ2412-0067 modificado |
| **type_code** | TEXT | AC_PROJECT_MODIFY |
| **date_action** | TEXT | 1733344217 |
| **fk_user_author** | TEXT | 5 |
| **socid** | TEXT | 210 |
| **project_id** | TEXT | 90 |
| **elementtype** | TEXT | null |
| **fk_element** | TEXT | null |
| **datec** | TEXT | 1733344217 |
| **tms** | TEXT | 1733344217 |

## tasks (500 rows)
- **Primary Key**: `id`
- **Potential Links**: `fk_user_assign, fk_user_creat, project_id, fk_parent`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 57 |
| **ref** | TEXT | TK2503-0036 |
| **label** | TEXT | CONFERIR RELATÓRIO HORAS (SEMANAL) |
| **description** | TEXT |  |
| **date_start** | TEXT | 1740798000 |
| **date_end** | TEXT | 1743476340 |
| **progress** | TEXT | 0 |
| **fk_user_assign** | TEXT | null |
| **fk_user_creat** | TEXT | 16 |
| **project_id** | TEXT | 141 |
| **datec** | TEXT | 1741620618 |
| **tms** | TEXT | 1742181608 |
| **fk_parent** | TEXT | 50 |

## thirdparties (757 rows)
- **Primary Key**: `id`
- **Potential Links**: `parent`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 3 |
| **name** | TEXT | Victor |
| **name_alias** | TEXT |  |
| **code_client** | TEXT | CU2407-00002 |
| **email** | TEXT | null |
| **phone** | TEXT | 11953572247 |
| **address** | TEXT |  |
| **zip** | TEXT | null |
| **town** | TEXT | null |
| **client** | TEXT | 1 |
| **fournisseur** | TEXT | 0 |
| **code_fournisseur** | TEXT | null |
| **status** | TEXT | 1 |
| **parent** | TEXT | null |
| **tms** | TEXT | 1722279662 |
| **datec** | TEXT | 1722101192 |

## tickets (231 rows)
- **Primary Key**: `id`
- **Potential Links**: `track_id, socid, project_id, fk_user_assign, fk_user_create`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 45 |
| **ref** | TEXT | TS2504-0002 |
| **track_id** | TEXT | 1wdipudsi8lpq997 |
| **subject** | TEXT | Léo Fortes - 5511954982125 |
| **message** | TEXT | Usuário: Oi
  Agente: Olá! Que bom falar com voc... |
| **type_code** | TEXT | OTHER |
| **category_code** | TEXT | IA_CHAT |
| **severity_code** | TEXT | NORMAL |
| **statut** | TEXT | 8 |
| **progress** | TEXT | 100 |
| **socid** | TEXT | 2147483647 |
| **project_id** | TEXT | null |
| **fk_user_assign** | TEXT | null |
| **fk_user_create** | TEXT | 1 |
| **origin_email** | TEXT | Léo Fortes |
| **datec** | TEXT | 1745098014 |
| **tms** | TEXT | 1745415358 |

## users (169 rows)
- **Primary Key**: `id`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 32 |
| **login** | TEXT | larissa de oliveira bueno.larissa de oliveira buen |
| **firstname** | TEXT | Larissa de Oliveira Bueno |
| **lastname** | TEXT | LARISSA DE OLIVEIRA BUENO |
| **email** | TEXT |  |
| **job** | TEXT |  |
| **phone_mobile** | TEXT |  |
| **photo** | TEXT | olga.png |
| **admin** | TEXT | 0 |
| **statut** | TEXT | 1 |
| **datec** | TEXT | 1741909252 |
| **tms** | TEXT | 1742334075 |

## warehouses (38 rows)
- **Primary Key**: `id`
| Column | Type | Sample Value |
| :--- | :--- | :--- |
| **id** | TEXT | 1 |
| **ref** | TEXT | Mars |
| **label** | TEXT | Mars |
| **description** | TEXT |  |
| **statut** | TEXT | 1 |
| **lieu** | TEXT |  |
| **datec** | TEXT | 1722270014 |
| **tms** | TEXT | 1722270014 |
