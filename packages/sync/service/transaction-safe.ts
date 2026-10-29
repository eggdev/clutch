/**
 * The mark of a service that a server change may use. Such a service only
 * reads and writes the transaction it is given, so a rollback undoes all of
 * its work. A service that calls a vendor or the network has no mark. A job
 * uses it after the commit instead. See docs/contributing/architecture/server.md.
 */
export const transactionSafe: unique symbol = Symbol('sync/transaction-safe');

/** The shape part that marks a service as safe in a transaction. */
type TransactionSafe = { readonly [transactionSafe]: true };

/** An Effect requirement whose service carries the mark. */
export type TransactionService = { readonly Service: TransactionSafe };
