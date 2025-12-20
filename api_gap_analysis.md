# API Gap Analysis Report (Strict Mode)
Generated at: 2025-12-13T02:01:04.091Z

This report compares Swagger paths against `dolibarrService.ts` using Regex matching.
## Module: AGENDAEVENTS
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/agendaevents` | ✅ | List Agenda Events 🔐 | get, post |
| `/agendaevents/{id}` | ✅ | Get properties of a Agenda Events object 🔐 | get, put, delete |

## Module: BANKACCOUNTS
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/bankaccounts` | ✅ | Get the list of accounts. 🔐 | get, post |
| `/bankaccounts/transfer` | ✅ | Create an internal wire transfer between two bank accounts 🔐 | post |
| `/bankaccounts/{id}` | ✅ | Get account by ID. 🔐 | get, put, delete |
| `/bankaccounts/{id}/balance` | ❌ | Get current account balance by ID 🔐 | get |
| `/bankaccounts/{id}/lines` | ✅ | Get the list of lines of the account. 🔐 | get, post |
| `/bankaccounts/{id}/lines/{line_id}` | ❌ | No summary | put, delete |
| `/bankaccounts/{id}/lines/{line_id}/links` | ❌ | Get the list of links for a line of the account. 🔐 | post, get |

## Module: CATEGORIES
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/categories` | ✅ | List categories 🔐 | get, post |
| `/categories/object/{type}/{id}` | ❌ | List categories of an object 🔐 | get |
| `/categories/{id}` | ✅ | Get properties of a category object 🔐 | get, put, delete |
| `/categories/{id}/objects` | ❌ | Get the list of objects in a category. 🔐 | get |
| `/categories/{id}/objects/{type}/ref/{object_ref}` | ❌ | Link an object to a category by ref 🔐 | post, delete |
| `/categories/{id}/objects/{type}/{object_id}` | ❌ | Link an object to a category by id 🔐 | post, delete |

## Module: CONTACTS
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/contacts` | ✅ | List contacts 🔐 | get, post |
| `/contacts/email/{email}` | ❌ | Get properties of a contact object by Email 🔐 | get |
| `/contacts/{id}` | ✅ | Get properties of a contact object 🔐 | get, put, delete |
| `/contacts/{id}/categories` | ❌ | Get categories for a contact 🔐 | get |
| `/contacts/{id}/categories/{category_id}` | ❌ | No summary | put, delete |
| `/contacts/{id}/createUser` | ❌ | Create an user account object from contact (external user) 🔐 | post |

## Module: DOCUMENTS
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/documents` | ✅ | Return the list of documents of a dedicated element (from its ID or Ref) 🔐 | get, delete |
| `/documents/builddoc` | ❌ | No summary | put |
| `/documents/download` | ✅ | Download a document. 🔐 | get |
| `/documents/upload` | ✅ | Upload a document. 🔐 | post |

## Module: EXPENSEREPORTS
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/expensereports` | ✅ | List Expense Reports 🔐 | get, post |
| `/expensereports/payments` | ❌ | Get the list of payments of expensereport. 🔐 | get |
| `/expensereports/payments/{pid}` | ❌ | Get a given payment. 🔐 | get |
| `/expensereports/{id}` | ❌ | Get properties of an Expense Report 🔐 | get, put, delete |
| `/expensereports/{id}/payments` | ❌ | Create payment of ExpenseReport 🔐 | post, put |

## Module: INTERVENTIONS
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/interventions` | ✅ | List of interventions Return a list of interventions 🔐 | get, post |
| `/interventions/{id}` | ✅ | Get properties of a Expense Report object Return an array with Expense Report information 🔐 | get, delete |
| `/interventions/{id}/close` | ❌ | Close an intervention 🔐 | post |
| `/interventions/{id}/lines` | ❌ | Add a line to a given intervention 🔐 | post |
| `/interventions/{id}/validate` | ✅ | Validate an intervention 🔐 | post |

## Module: INVOICES
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/invoices` | ✅ | List invoices 🔐 | get, post |
| `/invoices/createfromcontract/{contractid}` | ❌ | Create an invoice using a contract. 🔐 | post |
| `/invoices/createfromorder/{orderid}` | ❌ | Create an invoice using an existing order. 🔐 | post |
| `/invoices/payments/{id}` | ❌ | No summary | put |
| `/invoices/paymentsdistributed` | ❌ | Add a payment to pay partially or completely one or several invoices. 🔐 | post |
| `/invoices/ref/{ref}` | ❌ | Get properties of an invoice object by ref 🔐 | get |
| `/invoices/ref_ext/{ref_ext}` | ❌ | Get properties of an invoice object by ref_ext 🔐 | get |
| `/invoices/templates/{id}` | ❌ | Get properties of a template invoice object 🔐 | get |
| `/invoices/{id}` | ✅ | Get properties of a invoice object 🔐 | get, put, delete |
| `/invoices/{id}/contact/{contactid}/{type}` | ❌ | Add a contact type of given invoice 🔐 | post, delete |
| `/invoices/{id}/contacts` | ❌ | Adds a contact to an invoice 🔐 | post |
| `/invoices/{id}/discount` | ❌ | Get discount from invoice 🔐 | get |
| `/invoices/{id}/lines` | ❌ | Get lines of an invoice 🔐 | get, post |
| `/invoices/{id}/lines/{lineid}` | ❌ | No summary | put, delete |
| `/invoices/{id}/markAsCreditAvailable` | ❌ | Create a discount (credit available) for a credit note or a deposit. 🔐 | post |
| `/invoices/{id}/payments` | ✅ | Get list of payments of a given invoice 🔐 | get, post |
| `/invoices/{id}/settodraft` | ❌ | Sets an invoice as draft 🔐 | post |
| `/invoices/{id}/settopaid` | ✅ | Sets an invoice as paid 🔐 | post |
| `/invoices/{id}/settounpaid` | ❌ | Sets an invoice as unpaid 🔐 | post |
| `/invoices/{id}/usecreditnote/{discountid}` | ❌ | Add an available credit note discount to payments of an existing invoice. 🔐 | post |
| `/invoices/{id}/usediscount/{discountid}` | ❌ | Add a discount line into an invoice (as an invoice line) using an existing absolute discount 🔐 | post |
| `/invoices/{id}/validate` | ✅ | Validate an invoice 🔐 | post |

## Module: LOGIN
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/login` | ✅ | Login 🔓 | get, post |

## Module: PARTNERSHIPS
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/partnerships/partnerships` | ❌ | List partnerships 🔐 | get, post |
| `/partnerships/partnerships/{id}` | ❌ | Get properties of a partnership object 🔐 | get, put, delete |

## Module: PRODUCTS
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/products` | ✅ | List products 🔐 | get, post |
| `/products/attributes` | ❌ | Get attributes. 🔐 | get, post |
| `/products/attributes/ref/{ref}` | ❌ | Get attributes by ref. 🔐 | get |
| `/products/attributes/ref/{ref}/values` | ❌ | Get all values for an attribute ref. 🔐 | get |
| `/products/attributes/ref_ext/{ref_ext}` | ❌ | Get attributes by ref_ext. 🔐 | get |
| `/products/attributes/values/{id}` | ❌ | Get attribute value by id. 🔐 | get, put, delete |
| `/products/attributes/{id}` | ❌ | Get attribute by ID. 🔐 | get, put, delete |
| `/products/attributes/{id}/values` | ❌ | Get all values for an attribute id. 🔐 | get, post |
| `/products/attributes/{id}/values/ref/{ref}` | ❌ | Get attribute value by ref. 🔐 | get, delete |
| `/products/barcode/{barcode}` | ❌ | Get properties of a product object by barcode 🔐 | get |
| `/products/purchase_prices` | ❌ | Get a list of all purchase prices of products 🔐 | get |
| `/products/ref/{ref}` | ❌ | Get properties of a product object by ref 🔐 | get |
| `/products/ref/{ref}/variants` | ❌ | Get product variants by Product ref. 🔐 | get, post |
| `/products/ref_ext/{ref_ext}` | ❌ | Get properties of a product object by ref_ext 🔐 | get |
| `/products/variants/{id}` | ❌ | No summary | put, delete |
| `/products/{id}` | ✅ | Get properties of a product object by id 🔐 | get, put, delete |
| `/products/{id}/categories` | ❌ | Get categories for a product 🔐 | get |
| `/products/{id}/purchase_prices` | ❌ | Get purchase prices for a product 🔐 | post, get |
| `/products/{id}/purchase_prices/{priceid}` | ❌ | No summary | delete |
| `/products/{id}/selling_multiprices/per_customer` | ❌ | Get prices per customer for a product 🔐 | get |
| `/products/{id}/selling_multiprices/per_quantity` | ❌ | Get prices per quantity for a product 🔐 | get |
| `/products/{id}/selling_multiprices/per_segment` | ❌ | Get prices per segment for a product 🔐 | get |
| `/products/{id}/stock` | ✅ | Get stock data for the product id given. 🔐 | get |
| `/products/{id}/subproducts` | ❌ | Get the list of subproducts of the product. 🔐 | get |
| `/products/{id}/subproducts/add` | ❌ | Add subproduct. 🔐 | post |
| `/products/{id}/subproducts/remove/{subproduct_id}` | ❌ | No summary | delete |
| `/products/{id}/variants` | ❌ | Get product variants. 🔐 | get, post |

## Module: PROJECTS
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/projects` | ✅ | List projects 🔐 | get, post |
| `/projects/email_msgid/{email_msgid}` | ❌ | Get properties of a project object 🔐 | get |
| `/projects/ref/{ref}` | ❌ | Get properties of a project object 🔐 | get |
| `/projects/ref_ext/{ref_ext}` | ❌ | Get properties of a project object 🔐 | get |
| `/projects/{id}` | ✅ | Get properties of a project object 🔐 | get, put, delete |
| `/projects/{id}/roles` | ❌ | Get roles a user is assigned to a project with 🔐 | get |
| `/projects/{id}/tasks` | ✅ | Get tasks of a project. 🔐 | get |
| `/projects/{id}/validate` | ✅ | Validate a project. 🔐 | post |

## Module: PROPOSALS
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/proposals` | ✅ | List commercial proposals 🔐 | get, post |
| `/proposals/ref/{ref}` | ❌ | Get properties of an proposal object by ref 🔐 | get |
| `/proposals/ref_ext/{ref_ext}` | ❌ | Get properties of an proposal object by ref_ext 🔐 | get |
| `/proposals/{id}` | ✅ | Get properties of a commercial proposal object 🔐 | get, put, delete |
| `/proposals/{id}/close` | ✅ | Close (Accept or refuse) a quote / commercial proposal 🔐 | post |
| `/proposals/{id}/contact/{contactid}/{type}` | ❌ | No summary | delete |
| `/proposals/{id}/contact/{contactid}/{type}/{source}` | ❌ | Add a contact type of given commercial proposal 🔐 | post |
| `/proposals/{id}/line` | ❌ | Add a line to given commercial proposal 🔐 | post |
| `/proposals/{id}/lines` | ❌ | Get lines of a commercial proposal 🔐 | get, post |
| `/proposals/{id}/lines/{lineid}` | ❌ | No summary | put, delete |
| `/proposals/{id}/setinvoiced` | ❌ | Set a commercial proposal billed. Could be also called setbilled 🔐 | post |
| `/proposals/{id}/settodraft` | ❌ | Set a proposal to draft 🔐 | post |
| `/proposals/{id}/validate` | ❌ | Validate a commercial proposal 🔐 | post |

## Module: RECRUITMENTS
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/recruitments/candidature` | ✅ | List candatures 🔐 | get, post |
| `/recruitments/candidature/{id}` | ❌ | Get properties of a candidature object 🔐 | get, put, delete |
| `/recruitments/jobposition` | ✅ | List jobpositions 🔐 | get, post |
| `/recruitments/jobposition/{id}` | ❌ | Get properties of a jobposition object 🔐 | get, put, delete |

## Module: SETUP
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/setup/actiontriggers` | ❌ | Get the list of Action Triggers. 🔐 | get |
| `/setup/checkintegrity` | ❌ | Do a test of integrity for files and setup. 🔐 | get |
| `/setup/company` | ✅ | Get properties of company 🔐 | get |
| `/setup/conf/{constantname}` | ❌ | Get value of a setup variables 🔐 | get |
| `/setup/dictionary/availability` | ❌ | Get the list of delivery times. 🔐 | get |
| `/setup/dictionary/civilities` | ❌ | Get the list of civilities. 🔐 | get |
| `/setup/dictionary/contact_types` | ❌ | Get the list of contacts types. 🔐 | get |
| `/setup/dictionary/countries` | ❌ | Get the list of countries. 🔐 | get |
| `/setup/dictionary/countries/byCode/{code}` | ❌ | Get country by Code. 🔐 | get |
| `/setup/dictionary/countries/byISO/{iso}` | ❌ | Get country by Iso. 🔐 | get |
| `/setup/dictionary/countries/{id}` | ❌ | Get country by ID. 🔐 | get |
| `/setup/dictionary/currencies` | ❌ | Get the list of currencies. 🔐 | get |
| `/setup/dictionary/event_types` | ❌ | Get the list of events types. 🔐 | get |
| `/setup/dictionary/expensereport_types` | ❌ | Get the list of Expense Report types. 🔐 | get |
| `/setup/dictionary/incoterms` | ❌ | Get the list of incoterms. 🔐 | get |
| `/setup/dictionary/legal_form` | ❌ | Get the list of legal form of business. 🔐 | get |
| `/setup/dictionary/ordering_methods` | ❌ | Get the list of ordering methods. 🔐 | get |
| `/setup/dictionary/ordering_origins` | ❌ | Get the list of ordering origins. 🔐 | get |
| `/setup/dictionary/payment_terms` | ❌ | Get the list of payments terms. 🔐 | get |
| `/setup/dictionary/payment_types` | ❌ | Get the list of payments types. 🔐 | get |
| `/setup/dictionary/regions` | ❌ | Get the list of regions. 🔐 | get |
| `/setup/dictionary/regions/byCode/{code}` | ❌ | Get region by Code. 🔐 | get |
| `/setup/dictionary/regions/{id}` | ❌ | Get region by ID. 🔐 | get |
| `/setup/dictionary/shipping_methods` | ❌ | Get the list of shipping methods. 🔐 | get |
| `/setup/dictionary/socialnetworks` | ❌ | Get the list of social networks. 🔐 | get |
| `/setup/dictionary/staff` | ❌ | Get the list of staff. 🔐 | get |
| `/setup/dictionary/states` | ❌ | Get the list of states/provinces. 🔐 | get |
| `/setup/dictionary/states/byCode/{code}` | ❌ | Get state by Code. 🔐 | get |
| `/setup/dictionary/states/{id}` | ❌ | Get state by ID. 🔐 | get |
| `/setup/dictionary/ticket_categories` | ❌ | Get the list of tickets categories. 🔐 | get |
| `/setup/dictionary/ticket_severities` | ❌ | Get the list of tickets severity. 🔐 | get |
| `/setup/dictionary/ticket_types` | ❌ | Get the list of tickets types. 🔐 | get |
| `/setup/dictionary/towns` | ❌ | Get the list of towns. 🔐 | get |
| `/setup/dictionary/units` | ❌ | Get the list of measuring units. 🔐 | get |
| `/setup/establishments` | ❌ | Get the list of establishments. 🔐 | get |
| `/setup/establishments/{id}` | ❌ | Get establishment by ID. 🔐 | get |
| `/setup/extrafields` | ❌ | Get the list of extra fields. 🔐 | get |
| `/setup/extrafields/{elementtype}/{attrname}` | ❌ |  🔐 | delete, get, post, put |
| `/setup/modules` | ✅ | Get list of enabled modules 🔐 | get |

## Module: STATUS
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/status` | ✅ | Get status (Dolibarr version) 🔐 | get |

## Module: STOCKMOVEMENTS
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/stockmovements` | ✅ | Get a list of stock movement 🔐 | get, post |

## Module: SUPPLIERINVOICES
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/supplierinvoices` | ✅ | List invoices 🔐 | get, post |
| `/supplierinvoices/{id}` | ✅ | Get properties of a supplier invoice object 🔐 | get, put, delete |
| `/supplierinvoices/{id}/lines` | ❌ | Get lines of a supplier invoice 🔐 | get, post |
| `/supplierinvoices/{id}/lines/{lineid}` | ❌ | No summary | put, delete |
| `/supplierinvoices/{id}/payments` | ✅ | Get list of payments of a given supplier invoice 🔐 | get, post |
| `/supplierinvoices/{id}/validate` | ❌ | Validate an invoice 🔐 | post |

## Module: SUPPLIERORDERS
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/supplierorders` | ✅ | List orders 🔐 | get, post |
| `/supplierorders/{id}` | ✅ | Get properties of a supplier order object 🔐 | get, put, delete |
| `/supplierorders/{id}/approve` | ✅ | Approve an order 🔐 | post |
| `/supplierorders/{id}/contact/{contactid}/{type}/{source}` | ❌ | Add a contact type of given supplier order 🔐 | post, delete |
| `/supplierorders/{id}/contacts` | ❌ | Get contacts of given supplier order 🔐 | get |
| `/supplierorders/{id}/makeorder` | ❌ | Sends an order to the vendor 🔐 | post |
| `/supplierorders/{id}/receive` | ❌ | Receives the order, dispatches products. 🔐 | post |
| `/supplierorders/{id}/validate` | ✅ | Validate an order 🔐 | post |

## Module: SUPPLIERPROPOSALS
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/supplierproposals` | ❌ | List supplier proposals 🔐 | post, get |
| `/supplierproposals/{id}` | ❌ | Get properties of a supplier proposal (price request) object 🔐 | delete, get, put |

## Module: TASKS
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/tasks` | ✅ | List tasks 🔐 | get, post |
| `/tasks/timespentrecordchecks/{id}` | ❌ | Validate task & timespent IDs for timespent API methods. 🔐 | get |
| `/tasks/{id}` | ✅ | Get properties of a task object 🔐 | get, put, delete |
| `/tasks/{id}/addtimespent` | ✅ | Add time spent to a task of a project. 🔐 | post |
| `/tasks/{id}/roles` | ❌ | Get roles a user is assigned to a task with 🔐 | get |
| `/tasks/{id}/timespent/{timespent_id}` | ❌ | No summary | put, delete |

## Module: THIRDPARTIES
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/thirdparties` | ✅ | List thirdparties 🔐 | get, post |
| `/thirdparties/accounts/{site}/{key_account}` | ❌ | Get a specific thirdparty by account 🔐 | get |
| `/thirdparties/barcode/{barcode}` | ❌ | Get properties of a thirdparty object by barcode. 🔐 | get |
| `/thirdparties/email/{email}` | ❌ | Get properties of a thirdparty object by email. 🔐 | get |
| `/thirdparties/{id}` | ✅ | Get properties of a thirdparty object 🔐 | get, put, delete |
| `/thirdparties/{id}/accounts` | ❌ | Get a specific account attached to a thirdparty (by specifying the site key) 🔐 | get, post, delete |
| `/thirdparties/{id}/accounts/{site}` | ❌ | No summary | put, patch, delete |
| `/thirdparties/{id}/bankaccounts` | ❌ | Get CompanyBankAccount objects for thirdparty 🔐 | get, post |
| `/thirdparties/{id}/bankaccounts/{bankaccount_id}` | ❌ | No summary | put, delete |
| `/thirdparties/{id}/categories` | ❌ | Get customer categories for a thirdparty 🔐 | get |
| `/thirdparties/{id}/categories/{category_id}` | ❌ | No summary | put, delete |
| `/thirdparties/{id}/fixedamountdiscounts` | ❌ | Get fixed amount discount of a thirdparty (all sources: deposit, credit note, commercial offers...) 🔐 | get |
| `/thirdparties/{id}/generateBankAccountDocument/{companybankid}/{model}` | ❌ | Generate a Document from a bank account record (like SEPA mandate) 🔐 | get |
| `/thirdparties/{id}/getinvoicesqualifiedforcreditnote` | ❌ | Return list of invoices qualified to be corrected by a credit note. 🔐 | get |
| `/thirdparties/{id}/getinvoicesqualifiedforreplacement` | ❌ | Return list of invoices qualified to be replaced by another invoice. 🔐 | get |
| `/thirdparties/{id}/merge/{idtodelete}` | ❌ | No summary | put |
| `/thirdparties/{id}/notifications` | ❌ | Get CompanyNotification objects for thirdparty 🔐 | get, post |
| `/thirdparties/{id}/notifications/{notification_id}` | ❌ | No summary | delete, put |
| `/thirdparties/{id}/notificationsbycode/{code}` | ❌ | Create CompanyNotification object for thirdparty using action trigger code 🔐 | post |
| `/thirdparties/{id}/outstandinginvoices` | ✅ | Get outstanding invoices of thirdparty 🔐 | get |
| `/thirdparties/{id}/outstandingorders` | ❌ | Get outstanding orders of thirdparty 🔐 | get |
| `/thirdparties/{id}/outstandingproposals` | ❌ | Get outstanding proposals of thirdparty 🔐 | get |
| `/thirdparties/{id}/representative/{representative_id}` | ❌ | Add a customer representative to a thirdparty 🔐 | post, delete |
| `/thirdparties/{id}/representatives` | ❌ | Get representatives of thirdparty 🔐 | get |
| `/thirdparties/{id}/setpricelevel/{priceLevel}` | ❌ | No summary | put |
| `/thirdparties/{id}/supplier_categories` | ❌ | Get supplier categories for a thirdparty 🔐 | get |
| `/thirdparties/{id}/supplier_categories/{category_id}` | ❌ | No summary | put, delete |

## Module: TICKETS
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/tickets` | ✅ | List tickets 🔐 | get, post |
| `/tickets/newmessage` | ✅ | Add a new message to an existing ticket identified by property ->track_id into request. 🔐 | post |
| `/tickets/ref/{ref}` | ❌ | Get properties of a Ticket object from ref 🔐 | get |
| `/tickets/track_id/{track_id}` | ❌ | Get properties of a Ticket object from track id 🔐 | get |
| `/tickets/{id}` | ✅ | Get properties of a Ticket object. 🔐 | get, put, delete |

## Module: USERS
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/users` | ✅ | List Users 🔐 | get, post |
| `/users/email/{email}` | ❌ | Get properties of an user object by Email 🔐 | get |
| `/users/groups` | ❌ | List Groups 🔐 | get |
| `/users/groups/{group}` | ❌ | Get properties of an group object 🔐 | get |
| `/users/info` | ❌ | Get more properties of a user 🔐 | get |
| `/users/login/{login}` | ❌ | Get properties of an user object by login 🔐 | get |
| `/users/{id}` | ✅ | Get properties of an user object 🔐 | get, put, delete |
| `/users/{id}/groups` | ❌ | List the groups of a user 🔐 | get |
| `/users/{id}/setGroup/{group}` | ❌ | Add a user into a group 🔐 | get |
| `/users/{id}/setPassword` | ❌ | Update a user password 🔐 | get |

## Module: WAREHOUSES
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/warehouses` | ✅ | List warehouses 🔐 | get, post |
| `/warehouses/{id}` | ✅ | Get properties of a warehouse object 🔐 | get, put, delete |

## Module: WEBHOOK
| Endpoint | Used? | Summary | Methods |
|---|---|---|---|
| `/webhook` | ❌ | List targets 🔐 | get, post |
| `/webhook/triggers` | ❌ | Get the list of all available triggers 🔐 | get |
| `/webhook/{id}` | ❌ | Get properties of a target object 🔐 | get, put, delete |
