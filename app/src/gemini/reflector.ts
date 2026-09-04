// Prompting seam, part 3: reflection orchestration.
// Single responsibility — compose prompts, call the client, return text.
// Errors propagate typed (QuotaDepleted/Transient/Fatal): the ROUTE layer
// owns degradation policy (retry, visible pause, loud failure), never this.
import { buildSystemInstruction, buildUserMessage } from './prompts.js';
import type { IGeminiClient } from './client.js';
import type { GroundingSnapshot } from '../store/repository.js';

export async function reflect(
  entryText: string,
  snapshots: readonly GroundingSnapshot[],
  client: IGeminiClient,
): Promise<string> {
  return client.generate(buildSystemInstruction(), buildUserMessage(entryText, snapshots));
}
