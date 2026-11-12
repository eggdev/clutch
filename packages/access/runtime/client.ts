import { accessContract } from '@repo/access/contract/access';
import { clientPackage } from '@repo/sync/contract/define';

/**
 * The client half of the access package: its contract and the local change of
 * each command that shows at once. Each access command waits for the server
 * today, so the list is empty. The client apps list it in `packages`.
 */
export const accessClient = clientPackage(accessContract, []);
