/**
 * Dolibarr Service - Backward Compatibility Module
 * 
 * This file re-exports everything from the modular dolibarr/ directory
 * to maintain backward compatibility with existing imports.
 * 
 * The service has been decomposed into the following modules:
 * - core.ts: Base class, authentication, proxy
 * - thirdparties.ts: Customers, suppliers, contacts
 * - commercial.ts: Invoices, proposals, orders, contracts
 * - payments.ts: Payments, bank accounts
 * - products.ts: Products, warehouses, stock
 * - operations.ts: Projects, tasks, tickets, shipments
 * - hr.ts: Users, expense reports, leave requests
 * - manufacturing.ts: BOMs, manufacturing orders
 * - suppliers.ts: Supplier invoices and orders
 */

// Re-export everything from the modular implementation
export * from './dolibarr';
