import { AppError, newId, secretContextFor } from '../shared.ts';
import { RESEARCH_PAGE_LABELS, ResearchPageType, credentialIsUsable, stageReached, type ProductUnderstanding, type ResearchSource } from '@act-one/core';
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

  // Checked before a browser is opened, so an unusable address is a sentence
  // rather than a timeout somewhere inside the agent.
  assertResearchable(project.websiteUrl);

  await context.progress(0.02, 'Opening a browser');
  await context.activity({ step: 'research', kind: 'step', label: 'understanding product', status: 'active' });

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
      onProgress: ({ fraction, message }) => {
        void context.progress(0.15 + fraction * 0.7, message);
        const step = RESEARCH_STEP_LINES[message];
        if (step) void context.activity({ step: step.step, kind: 'step', label: step.label, status: 'active' });
      },
      // Each page, as it is read: the customer watches the research happen.
      onPage: (page) =>
        void context.activity({
          step: 'research',
          kind: 'page',
          index: page.index,
          label: pageLine(page.url, project.websiteUrl),
          detail: page.title.slice(0, 120) || null,
          status: page.statusCode >= 400 ? 'failed' : 'done',
        }),
    },
    call,
  );

  await context.progress(0.9, 'Saving what we found');
  await context.activity({
    step: 'research',
    kind: 'step',
    label: `${result.pages.filter((page) => page.statusCode < 400).length} pages read`,
    status: 'done',
  });
  await context.activity({ step: 'brand', kind: 'step', label: 'analyzing visual identity', status: 'active' });

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
      library: true,
      name: `${hostOf(project.websiteUrl)} — home`,
      category: 'screenshot',
      description: `The homepage of ${hostOf(project.websiteUrl)}, as the research first saw it.`,
      source: 'browser_research',
      attachTo: [project.id],
    });
  }

  // Moment screenshots are written before the understanding, so the stored
  // moments carry real asset ids rather than placeholders.
  const momentsWithAssets = await Promise.all(
    result.understanding.productMoments.map(async (moment) => {
      const bytes = capturedMoments.captures.get(moment.id);
      if (!bytes) {
        // Not observed in the product, but the public site showed it: the page
        // or the product image the research agent matched to this moment.
        const publicCapture = result.momentCaptures.get(moment.id);
        if (!publicCapture) return moment;
        const stored = await storeAsset(context, {
          data: publicCapture.bytes,
          kind: 'screenshot',
          origin: 'captured',
          rights: 'customer_owned',
          extension: 'png',
          contentType: 'image/png',
          sourceUrl: publicCapture.pageUrl,
          width: publicCapture.width,
          height: publicCapture.height,
          metadata: {
            momentId: moment.id,
            captureKind: publicCapture.kind,
            label: publicCapture.label,
          },
          // A product image the site published is the product; a page is a page.
          library: true,
          name: publicCapture.label || moment.title,
          category: publicCapture.kind === 'product_image' ? 'product' : 'screenshot',
          description: `${moment.title}: ${publicCapture.kind === 'product_image' ? 'a product image published on' : 'the page at'} ${withoutQuery(publicCapture.pageUrl)}.`,
          source: 'browser_research',
          attachTo: [project.id],
        });
        return { ...moment, screenshots: [stored.asset.id] };
      }

      // Observed inside the product, with the customer's own access. The
      // library keeps the picture and the moment's name; never the session
      // that took it, and never an address with anything in its query.
      const before = await storeAsset(context, {
        data: bytes.before,
        kind: 'screenshot',
        origin: 'captured',
        rights: 'customer_owned',
        extension: 'png',
        contentType: 'image/png',
        sourceUrl: moment.sourceUrl ? withoutQuery(moment.sourceUrl) : null,
        metadata: { momentId: moment.id, state: 'before' },
        library: true,
        name: bytes.after ? `${moment.title} — before` : moment.title,
        category: 'ui',
        description: `${moment.title}, inside the product${bytes.after ? ', before the action' : ''}.`,
        source: 'browser_research',
        attachTo: [project.id],
      });

      const after = bytes.after
        ? await storeAsset(context, {
            data: bytes.after,
            kind: 'screenshot',
            origin: 'captured',
            rights: 'customer_owned',
            extension: 'png',
            contentType: 'image/png',
            sourceUrl: moment.sourceUrl ? withoutQuery(moment.sourceUrl) : null,
            metadata: { momentId: moment.id, state: 'after' },
            library: true,
            name: `${moment.title} — after`,
            category: 'ui',
            description: `${moment.title}, inside the product, after the action.`,
            source: 'browser_research',
            attachTo: [project.id],
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

  /*
   * The trail: every page read, with its screenshot as our own asset and
   * what the brief took from it. Kept so the customer can inspect what the
   * system actually used, and so a later run has the same ground to stand on.
   */
  await keepResearchTrail(context, result, understanding);

  // Why the film will or will not show the product, in the log an operator
  // reads — not in the customer's brief, which says only what it shows.
  store.log.recordSafely({
    level: 'info',
    source: 'worker',
    event: 'research.captures',
    message: result.captureNotes[0] ?? 'No capture decisions recorded.',
    organizationId,
    projectId: project.id,
    jobId: context.jobId,
    actorUserId: null,
    durationMs: null,
    detail: {
      notes: result.captureNotes.slice(1),
      moments: momentsWithAssets.map((moment) => ({
        title: moment.title,
        captureKind: moment.captureKind,
        screenshots: moment.screenshots.length,
      })),
    },
  });

  // One brand per organisation, reused across projects. A second project for
  // the same company should not re-measure and land somewhere slightly
  // different — that is how two films for one customer stop matching.
  const existingBrands = await store.brands.list(organizationId);
  const existing = existingBrands.find((brand) => brand.confirmedByUser);
  const brand = existing ?? (await store.brands.create(result.brand));
  await context.activity({
    step: 'brand',
    kind: 'step',
    label: existing ? 'brand already confirmed for this workspace' : `brand measured from ${result.brand.sources.length} pages`,
    detail: `${brand.primaryColor} · ${brand.typography.find((font) => font.role === 'display')?.family ?? 'system type'} · ${brand.visualStyle}`,
    status: 'done',
  });

  /*
   * The stage only moves forward. This same stage runs again when a customer
   * authorises their product later on — new screens, a better brief — and a
   * project that already has a film would otherwise be told it had just
   * finished reading its own website, with the film still sitting on the page
   * underneath the wrong headline.
   */
  await store.projects.update(organizationId, project.id, {
    productUnderstandingId: understanding.id,
    brandId: brand.id,
    ...(stageReached(project.stage, 'concepting') ? {} : { stage: 'understanding_ready' }),
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
  // One definition of usable, shared with the pages that offer to use it.
  if (!credential || !credentialIsUsable(credential)) return empty;

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

function assertResearchable(websiteUrl: string): void {
  if (!websiteUrl) throw new AppError('validation_failed', 'This project has no website to read.');
  let parsed: URL;
  try {
    parsed = new URL(websiteUrl);
  } catch {
    throw new AppError('validation_failed', `${websiteUrl} is not an address we can open.`);
  }
  // A browser agent pointed at file:// or a private address is a way to read
  // this machine rather than a customer's product.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AppError('validation_failed', 'A product lives at an http or https address.');
  }
}

/** The research agent's progress lines, as the steps the customer sees them as. */
const RESEARCH_STEP_LINES: Record<string, { step: 'research' | 'brand'; label: string }> = {
  'Reading the brand': { step: 'brand', label: 'analyzing visual identity' },
  'Gathering evidence': { step: 'research', label: 'extracting positioning' },
  'Understanding the product': { step: 'research', label: 'identifying target audience' },
  'Choosing what to show': { step: 'research', label: 'finding product moments' },
};

/** "homepage", "/pricing", "linkedin.com/company/…": the page as a line of activity. */
function pageLine(url: string, websiteUrl: string): string {
  try {
    const page = new URL(url);
    const home = new URL(websiteUrl);
    const path = page.pathname.replace(/\/$/, '');
    if (page.hostname.replace(/^www\./, '') === home.hostname.replace(/^www\./, '')) {
      return path.length > 1 ? path : 'homepage';
    }
    return `${page.hostname.replace(/^www\./, '')}${path.length > 1 ? path : ''}`.slice(0, 80);
  } catch {
    return url.slice(0, 80);
  }
}

function pageTypeOf(intent: string, url: string): ResearchSource['pageType'] {
  if (/linkedin\.com|twitter\.com|x\.com|youtube\.com|instagram\.com/i.test(url)) return 'social';
  if (/producthunt\.com/i.test(url)) return 'launch_profile';
  return (ResearchPageType.options as readonly string[]).includes(intent) ? (intent as ResearchSource['pageType']) : 'other';
}

async function keepResearchTrail(
  context: StageContext,
  result: Awaited<ReturnType<ProductResearchAgent['research']>>,
  understanding: ProductUnderstanding,
): Promise<void> {
  const { store, project, organizationId } = context;
  // What each page gave the brief: the claims that cite evidence found on it.
  const evidenceUrl = new Map(understanding.evidence.map((item) => [item.id, item.sourceUrl] as const));
  const claims = [
    ...understanding.keyBenefits,
    ...understanding.differentiators,
    ...understanding.proofPoints,
    ...understanding.painPoints,
    ...understanding.coreFeatures,
  ];
  const findingsFor = (url: string): string[] => {
    const found: string[] = [];
    for (const claim of claims) {
      if (claim.evidenceIds.some((id) => evidenceUrl.get(id) === url) && !found.includes(claim.text)) found.push(claim.text);
      if (found.length >= 4) break;
    }
    return found;
  };

  const sources: ResearchSource[] = [];
  for (const page of result.pages) {
    let screenshotAssetId: string | null = null;
    if (page.screenshot && page.statusCode < 400) {
      try {
        const pageType = pageTypeOf(page.intent, page.url);
        const stored = await storeAsset(context, {
          data: page.screenshot,
          kind: 'screenshot',
          origin: 'captured',
          rights: 'customer_owned',
          extension: 'png',
          contentType: 'image/png',
          sourceUrl: withoutQuery(page.url),
          metadata: {
            role: 'research',
            source: 'browser_research',
            pageUrl: withoutQuery(page.url),
            pageTitle: page.title,
            pageType,
            capturedAt: page.capturedAt,
          },
          // Useful to the film later, so it goes in the library: the
          // customer's own pages are the most honest pictures of the product
          // there are, and a person may want the pricing page in a shot.
          library: true,
          name: page.title.trim().slice(0, 120) || withoutQuery(page.url),
          category: 'screenshot',
          description: `${RESEARCH_PAGE_LABELS[pageType]} page at ${withoutQuery(page.url)}${page.reason ? `: ${page.reason}` : ''}.`,
          source: 'browser_research',
          attachTo: [project.id],
        });
        screenshotAssetId = stored.asset.id;
      } catch (error) {
        console.error('[research] page screenshot not kept:', (error as Error).message.slice(0, 160));
      }
    }
    let domain = page.url;
    try {
      domain = new URL(page.url).hostname.replace(/^www\./, '');
    } catch {
      // Keep the URL as the domain.
    }
    const pageType = pageTypeOf(page.intent, page.url);
    sources.push({
      id: newId('src'),
      organizationId,
      projectId: project.id,
      jobId: context.jobId,
      position: page.index,
      url: page.url,
      title: page.title.slice(0, 300),
      domain: domain.slice(0, 200),
      pageType,
      reason: page.reason.slice(0, 300),
      visitedAt: page.capturedAt,
      screenshotAssetId,
      excerpt: page.excerpt.slice(0, 800),
      findings: findingsFor(page.url).map((text) => text.slice(0, 300)),
      evidenceCount: result.evidenceByUrl[page.url] ?? 0,
      statusCode: page.statusCode,
      useful: page.statusCode < 400,
    });
  }
  await store.researchSources.replaceForProject(organizationId, project.id, sources);
}

/** The address without its query or fragment: a token in a URL is a secret, and the library keeps none. */
function withoutQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split(/[?#]/)[0] ?? url;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
