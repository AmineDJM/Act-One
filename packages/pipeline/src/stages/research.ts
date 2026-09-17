import { AppError, newId, secretContextFor } from '../shared.ts';
import { ProductResearchAgent, ProductExplorer } from '@act-one/research';
import type { SecretVault } from '@act-one/providers';
import { policyForAuthenticatedProduct } from '@act-one/providers';
import { storeAsset, type StageContext } from '../context.ts';

/**
 * Research stage.
 *
 * Public research always runs. Authenticated product exploration runs only when
 * the customer has supplied credentials, and it runs FIRST so the moments it
 * captures are available to the understanding synthesis — a brief written
 * without knowing what the product actually looks like in use produces
 * concepts that cannot be filmed.
 */
export async function runResearch(
  context: StageContext,
  options: { vault?: SecretVault } = {},
): Promise<{ understandingId: string; brandId: string }> {
  const { store, registry, project, organizationId } = context;
  const call = { organizationId, projectId: project.id, signal: context.signal };

  await context.progress(0.02, 'Opening a browser');

  const capturedMoments = await exploreProduct(context, options.vault);

  const agent = new ProductResearchAgent(
    registry.browser(),
    registry.llm(),
    registry.browserFallback(),
  );

  const result = await agent.research(
    {
      organizationId,
      projectId: project.id,
      websiteUrl: project.websiteUrl,
      supplementalUrls: project.supplementalUrls,
      hints: {
        targetAudience: project.brief.targetAudience,
        goal: project.brief.goal,
        keyMessage: project.brief.keyMessage,
      },
      capturedMoments: capturedMoments.moments,
      maxPages: 12,
      onProgress: ({ fraction, message }) =>
        void context.progress(0.15 + fraction * 0.7, message),
    },
    call,
  );

  await context.progress(0.9, 'Saving what we found');

  // The homepage capture becomes the brand confirmation screen's evidence.
  if (result.heroScreenshot) {
    await storeAsset(context, {
      data: result.heroScreenshot,
      kind: 'screenshot',
      origin: 'captured',
      rights: 'customer_owned',
      extension: 'png',
      contentType: 'image/png',
      sourceUrl: project.websiteUrl,
      metadata: { role: 'hero' },
    });
  }

  // Moment screenshots are written before the understanding, so the stored
  // moments carry real asset ids rather than placeholders.
  const momentsWithAssets = await Promise.all(
    result.understanding.productMoments.map(async (moment) => {
      const bytes = capturedMoments.captures.get(moment.id);
      if (!bytes) return moment;

      const before = await storeAsset(context, {
        data: bytes.before,
        kind: 'screenshot',
        origin: 'captured',
        rights: 'customer_owned',
        extension: 'png',
        contentType: 'image/png',
        sourceUrl: moment.sourceUrl,
        metadata: { momentId: moment.id, state: 'before' },
      });

      const after = bytes.after
        ? await storeAsset(context, {
            data: bytes.after,
            kind: 'screenshot',
            origin: 'captured',
            rights: 'customer_owned',
            extension: 'png',
            contentType: 'image/png',
            sourceUrl: moment.sourceUrl,
            metadata: { momentId: moment.id, state: 'after' },
          })
        : null;

      return {
        ...moment,
        screenshots: [before.asset.id, ...(after ? [after.asset.id] : [])],
      };
    }),
  );

  const understanding = await store.understandings.create(
    { ...result.understanding, productMoments: momentsWithAssets },
    organizationId,
  );

  // One brand per organisation, reused across projects. A second project for
  // the same company should not re-measure and land somewhere slightly
  // different — that is how two films for one customer stop matching.
  const existingBrands = await store.brands.list(organizationId);
  const existing = existingBrands.find((brand) => brand.confirmedByUser);
  const brand = existing ?? (await store.brands.create(result.brand));

  await store.projects.update(organizationId, project.id, {
    productUnderstandingId: understanding.id,
    brandId: brand.id,
    stage: 'understanding_ready',
  });

  await context.progress(1, 'Done');
  return { understandingId: understanding.id, brandId: brand.id };
}

/**
 * Authenticated exploration.
 *
 * Only ever runs with credentials the customer explicitly authorised, decrypted
 * here and never written anywhere. Every action is audited, and a failure is
 * swallowed rather than failing the whole research stage — a customer whose
 * demo login has expired should still get their brief.
 */
async function exploreProduct(context: StageContext, vault?: SecretVault) {
  const empty = { moments: [], captures: new Map<string, { before: Uint8Array; after: Uint8Array | null }>() };
  const { store, registry, project, organizationId } = context;

  if (!project.productCredentialId || !vault) return empty;

  const credential = await store.credentials.getForProject(organizationId, project.id);
  if (!credential || credential.revokedAt) return empty;

  const sealed = await store.credentials.getCiphertext(organizationId, credential.id);
  if (!sealed) return empty;

  let secret: string;
  try {
    secret = vault.decrypt(sealed as never, secretContextFor(organizationId, project.id));
  } catch {
    // Wrong vault key or a row that was moved between tenants. Either way we
    // do not have usable credentials and must not guess.
    await store.credentials.audit({
      id: newId('evt'),
      credentialId: credential.id,
      organizationId,
      projectId: project.id,
      action: 'blocked',
      detail: 'Stored credential could not be decrypted in this context.',
      createdAt: new Date().toISOString(),
    });
    return empty;
  }

  await context.progress(0.05, 'Signing in to your product');

  const explorer = new ProductExplorer(registry.browser(), registry.llm());
  const audit = (event: { action: string; detail: string }) =>
    void store.credentials.audit({
      id: newId('evt'),
      credentialId: credential.id,
      organizationId,
      projectId: project.id,
      action: event.action as 'session_open' | 'navigate' | 'capture' | 'session_close' | 'blocked',
      detail: event.detail,
      createdAt: new Date().toISOString(),
    });

  try {
    // Constructed here purely to validate the paths before a session opens; the
    // explorer builds its own from the same inputs.
    policyForAuthenticatedProduct({
      loginUrl: credential.loginUrl,
      allowedPaths: credential.allowedPaths,
      deniedPaths: credential.deniedPaths,
    });

    const result = await explorer.explore(
      {
        organizationId,
        projectId: project.id,
        productName: project.name,
        focus: project.brief.keyMessage ?? undefined,
        maxMoments: 5,
        credentials: {
          loginUrl: credential.loginUrl,
          username: credential.username,
          secret,
          allowedPaths: credential.allowedPaths,
          deniedPaths: credential.deniedPaths,
        },
        onAudit: audit,
      },
      { organizationId, projectId: project.id, signal: context.signal },
    );

    await store.credentials.touch(organizationId, credential.id);
    return result;
  } catch (error) {
    await audit({
      action: 'blocked',
      detail: `Exploration failed: ${(error as Error).message.slice(0, 200)}`,
    });
    // Research continues without product footage rather than failing outright.
    return empty;
  } finally {
    // The plaintext is not referenced again. Node strings are immutable so this
    // is a scoping guarantee, not an erasure one — which is exactly why it is
    // never written to a variable that outlives this function.
    secret = '';
    void secret;
  }
}

export function assertResearchable(websiteUrl: string): void {
  if (!websiteUrl) throw new AppError('validation_failed', 'This project has no website to read.');
}
