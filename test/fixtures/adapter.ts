import { DshTransport } from '../../src/adapters/dsh.ts';
// Explicit test adapter; never registered by the production service by default.
export default new DshTransport();
