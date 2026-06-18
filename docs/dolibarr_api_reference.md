# Dolibarr REST API Reference

**Base URL**: `/api/index.php`
**Authentication**: Header `DOLAPIKEY: <your_api_key>`

## Global Query Parameters
These parameters apply to most `GET` list endpoints.
- `sortfield` (string): Database field to sort by (e.g., `t.rowid`, `t.ref`, `t.date_creation`).
- `sortorder` (string): `ASC` or `DESC`.
- `limit` (long): Limit results (default: 100).
- `page` (long): Page number (starts at 0).
- `sqlfilters` (string): Advanced filtering. Syntax: `(t.field:like:'value')` or `(t.field:=:value)`.
    - Example: `(t.ref:like:'SO-%') and (t.date_creation:>=:'2023-01-01')`

---

## Resources & Endpoints

### AgendaEvents
*   `GET /agendaevents`: List events. Filters: `user_ids` (comma separated).
*   `POST /agendaevents`: Create event. Body: `{ label, date_start, date_end, type_code, description, ... }`.
*   `GET /agendaevents/{id}`: Retrieve event details.
*   `PUT /agendaevents/{id}`: Update event.
*   `DELETE /agendaevents/{id}`: Remove event.

### BankAccounts
*   `GET /bankaccounts`: List accounts.
*   `POST /bankaccounts`: Create account.
*   `GET /bankaccounts/{id}`: Retrieve account.
*   `PUT /bankaccounts/{id}`: Update account.
*   `DELETE /bankaccounts/{id}`: Delete account.
*   `GET /bankaccounts/{id}/lines`: Get transactions/lines.
*   `POST /bankaccounts/{id}/lines`: Add transaction line. Body: `{ date, type, label, amount, ... }`.
*   `PUT /bankaccounts/{id}/lines/{line_id}`: Update transaction line.
*   `DELETE /bankaccounts/{id}/lines/{line_id}`: Delete transaction line.
*   `POST /bankaccounts/transfer`: Create internal wire transfer. Body: `{ bankaccount_from_id, bankaccount_to_id, amount, date, ... }`.

### Categories
*   `GET /categories`: List categories. Params: `type` (member, customer, supplier, product, contact, project).
*   `POST /categories`: Create category.
*   `GET /categories/{id}`: Retrieve category.
*   `PUT /categories/{id}`: Update category.
*   `DELETE /categories/{id}`: Delete category.
*   `GET /categories/{id}/objects`: Get objects linked to category. Params: `type`.
*   `POST /categories/{id}/objects/{type}/{object_id}`: Link object to category.
*   `DELETE /categories/{id}/objects/{type}/{object_id}`: Unlink object.

### Contacts
*   `GET /contacts`: List contacts. Filters: `thirdparty_ids`.
*   `POST /contacts`: Create contact.
*   `GET /contacts/{id}`: Retrieve contact.
*   `PUT /contacts/{id}`: Update contact.
*   `DELETE /contacts/{id}`: Delete contact.
*   `GET /contacts/email/{email}`: Retrieve by email.
*   `POST /contacts/{id}/createUser`: Create a Dolibarr user from a contact.

### Documents
*   `GET /documents`: Return list of documents for an element. Params: `modulepart` (invoice, proposal, project...), `id` or `ref`.
*   `GET /documents/download`: Download file content (wrapper). Params: `modulepart`, `original_file`.
*   `POST /documents/upload`: Upload file. Body: `{ filename, modulepart, ref, filecontent (base64), fileencoding: 'base64' }`.
*   `DELETE /documents`: Delete file. Params: `modulepart`, `original_file`.

### ExpenseReports
*   `GET /expensereports`: List reports. Filters: `user_ids`, `status`.
*   `POST /expensereports`: Create report.
*   `GET /expensereports/{id}`: Retrieve report.
*   `PUT /expensereports/{id}`: Update report.
*   `DELETE /expensereports/{id}`: Delete report.
*   `POST /expensereports/{id}/payments`: Add payment.
*   `GET /expensereports/{id}/payments`: Get payments.

### Interventions (Fichinter)
*   `GET /interventions`: List interventions.
*   `POST /interventions`: Create intervention.
*   `GET /interventions/{id}`: Retrieve intervention.
*   `POST /interventions/{id}/lines`: Add line.
*   `POST /interventions/{id}/validate`: Validate intervention.
*   `POST /interventions/{id}/close`: Close intervention.

### Invoices (Customer)
*   `GET /invoices`: List invoices. Filters: `thirdparty_ids`, `status` (draft, unpaid, paid, cancelled).
*   `POST /invoices`: Create invoice. Body: `{ socid, date, lines: [...] }`.
*   `GET /invoices/{id}`: Retrieve invoice.
*   `PUT /invoices/{id}`: Update invoice.
*   `DELETE /invoices/{id}`: Delete invoice.
*   `GET /invoices/{id}/lines`: Get invoice lines.
*   `POST /invoices/{id}/lines`: Add line. Body: `{ desc, subprice, qty, fk_product, ... }`.
*   `PUT /invoices/{id}/lines/{lineid}`: Update line.
*   `DELETE /invoices/{id}/lines/{lineid}`: Delete line.
*   `POST /invoices/{id}/validate`: Validate invoice. Body: `{ idwarehouse, notrigger }`.
*   `POST /invoices/{id}/payments`: Add payment. Body: `{ datepaye, paymentid, closepaidinvoices, accountid, amount }`.
*   `POST /invoices/{id}/settopaid`: Mark as paid.
*   `POST /invoices/{id}/settodraft`: Set back to draft.
*   `POST /invoices/createfromorder/{orderid}`: Create invoice from order.

### Login
*   `POST /login`: Request API token (Not recommended, use static Key).
*   `GET /login`: Request API token (Not recommended).

### Products
*   `GET /products`: List products. Filters: `mode` (0=all, 1=product, 2=service), `category`.
*   `POST /products`: Create product.
*   `GET /products/{id}`: Retrieve product.
*   `PUT /products/{id}`: Update product.
*   `DELETE /products/{id}`: Delete product.
*   `GET /products/{id}/stock`: Get stock data. Optional: `selected_warehouse_id`.
*   `GET /products/ref/{ref}`: Retrieve by Ref.
*   `GET /products/barcode/{barcode}`: Retrieve by Barcode.

### Projects
*   `GET /projects`: List projects. Filters: `thirdparty_ids`.
*   `POST /projects`: Create project.
*   `GET /projects/{id}`: Retrieve project.
*   `PUT /projects/{id}`: Update project.
*   `DELETE /projects/{id}`: Delete project.
*   `GET /projects/{id}/tasks`: Get tasks for project.
*   `POST /projects/{id}/validate`: Validate project.
*   `GET /projects/{id}/roles`: Get user roles on project.

### Proposals (Commercial)
*   `GET /proposals`: List proposals. Filters: `thirdparty_ids`.
*   `POST /proposals`: Create proposal.
*   `GET /proposals/{id}`: Retrieve proposal.
*   `PUT /proposals/{id}`: Update proposal.
*   `DELETE /proposals/{id}`: Delete proposal.
*   `POST /proposals/{id}/validate`: Validate proposal.
*   `POST /proposals/{id}/close`: Close (Sign/Refuse). Body: `{ status: 2 (signed) | 3 (refused), note_private }`.
*   `POST /proposals/{id}/settodraft`: Set to draft.
*   `GET /proposals/{id}/lines`: Get lines.

### Recruitments
*   `GET /recruitments/jobposition`: List job positions.
*   `POST /recruitments/jobposition`: Create job position.
*   `GET /recruitments/candidature`: List candidatures.

### Setup
*   `GET /setup/company`: Get company info.
*   `GET /setup/modules`: Get enabled modules.
*   `GET /setup/dictionary/countries`: List countries.
*   `GET /setup/dictionary/currencies`: List currencies.
*   `GET /setup/dictionary/payment_types`: List payment types (Cash, Transfer, etc.).

### Status
*   `GET /status`: Get Dolibarr version and status.

### StockMovements
*   `GET /stockmovements`: List movements.
*   `POST /stockmovements`: Create movement. Body: `{ product_id, warehouse_id, qty, type (0=in, 1=out), ... }`.

### SupplierInvoices
*   `GET /supplierinvoices`: List supplier invoices. Filters: `thirdparty_ids`.
*   `POST /supplierinvoices`: Create supplier invoice.
*   `GET /supplierinvoices/{id}`: Retrieve.
*   `POST /supplierinvoices/{id}/validate`: Validate.
*   `POST /supplierinvoices/{id}/payments`: Add payment.

### SupplierOrders
*   `GET /supplierorders`: List supplier orders. Filters: `thirdparty_ids`, `status`.
*   `POST /supplierorders`: Create order.
*   `GET /supplierorders/{id}`: Retrieve.
*   `POST /supplierorders/{id}/validate`: Validate.
*   `POST /supplierorders/{id}/approve`: Approve.
*   `POST /supplierorders/{id}/makeorder`: Send order.
*   `POST /supplierorders/{id}/receive`: Receive items (dispatch).

### Tasks
*   `GET /tasks`: List tasks.
*   `POST /tasks`: Create task.
*   `GET /tasks/{id}`: Retrieve task.
*   `PUT /tasks/{id}`: Update task.
*   `DELETE /tasks/{id}`: Delete task.
*   `POST /tasks/{id}/addtimespent`: Add time. Body: `{ date, duration (sec), user_id, note }`.

### ThirdParties
*   `GET /thirdparties`: List thirdparties. Filters: `mode` (1=cust, 4=supplier).
*   `POST /thirdparties`: Create thirdparty.
*   `GET /thirdparties/{id}`: Retrieve thirdparty.
*   `PUT /thirdparties/{id}`: Update thirdparty.
*   `DELETE /thirdparties/{id}`: Delete thirdparty.
*   `GET /thirdparties/{id}/outstandinginvoices`: Get outstanding invoices.

### Tickets
*   `GET /tickets`: List tickets. Filters: `socid`.
*   `POST /tickets`: Create ticket.
*   `GET /tickets/{id}`: Retrieve ticket.
*   `PUT /tickets/{id}`: Update ticket.
*   `POST /tickets/newmessage`: Add message. Body: `{ track_id, message, ... }`.

### Users
*   `GET /users`: List users.
*   `POST /users`: Create user.
*   `GET /users/{id}`: Retrieve user.
*   `PUT /users/{id}`: Update user.
*   `DELETE /users/{id}`: Delete user.

### Warehouses
*   `GET /warehouses`: List warehouses.
*   `POST /warehouses`: Create warehouse.
*   `GET /warehouses/{id}`: Retrieve warehouse.
*   `PUT /warehouses/{id}`: Update warehouse.

### Webhook
*   `GET /webhook`: List webhooks.
*   `POST /webhook`: Create webhook.

---

## Key Data Models (Common Fields)

### Invoice Line
`{ desc, subprice, qty, tva_tx (vat rate), fk_product, product_type (0/1), ... }`

### Payment
`{ datepaye, paymentid (mode), closepaidinvoices (yes/no), accountid, amount, num_payment }`

### Document Upload
`{ filename, modulepart, ref, filecontent (base64), fileencoding: 'base64' }`