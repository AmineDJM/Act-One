export { AppError, newId } from '@act-one/core';
import { secretContext } from '@act-one/providers';

/** One place that knows how a product credential's AAD context is built. */
export function secretContextFor(organizationId: string, projectId: string): string {
  return secretContext.productCredential(organizationId, projectId);
}
