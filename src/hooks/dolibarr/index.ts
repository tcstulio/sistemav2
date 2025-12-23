/**
 * Dolibarr Hooks - Main Export File
 * 
 * This file re-exports all hooks from the new factory-based implementation.
 * It maintains backward compatibility with existing imports.
 * 
 * Usage:
 *   import { useCustomers, useInvoices } from './hooks/dolibarr';
 * 
 * Or individual hooks:
 *   import { useCustomers } from './hooks/dolibarr/hooks';
 */

// Export all hooks from the factory-based implementation
export * from './hooks';

// Export the factory for creating custom hooks
export { createDolibarrHook } from './createDolibarrHook';
export type { DolibarrHookConfig, DolibarrHookResult, EntityFromHook } from './createDolibarrHook';

// Export mappers for external use (e.g., in services or transformations)
export * as mappers from './mappers';

// Legacy re-exports for backward compatibility
// These can be removed once all components are updated to use the new imports
export { useModules } from './useModules';
