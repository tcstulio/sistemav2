/**
 * Banking Services Module
 * 
 * This module exports the abstract base class and common types
 * for banking integrations.
 * 
 * Usage:
 *   import { BankingApiBase, BankBalance } from './banking';
 *   
 *   // Or for specific banks:
 *   import { interApiService } from '../interApiService';
 *   import { itauApiService } from '../itauApiService';
 */

export {
    BankingApiBase,
    BankBalance,
    BankTransaction,
    BankStatement,
    PixChargeRequest,
    PixChargeResponse,
    BoletoRequest,
    BoletoResponse,
    BankServiceStatus,
    BankUrlConfig,
} from './bankingApiBase';
