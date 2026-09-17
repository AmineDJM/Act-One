/**
 * Egress proxy support.
 *
 * Node's built-in `fetch` ignores HTTPS_PROXY. That is fine on a machine with
 * direct egress and wrong everywhere else: plenty of companies require all
 * outbound traffic to leave through a proxy, and without this every provider
 * call from a deploy inside one fails with a timeout or a bare 401 that looks
 * like a bad API key.
 *
 * Installed once, at startup, before any provider is constructed. undici reads
 * HTTP_PROXY / HTTPS_PROXY / NO_PROXY itself, so the standard variables an
 * operator already sets are the configuration — there is nothing Act
 * One-specific to learn.
 */
let installed = false;

export async function installProxyFromEnvironment(): Promise<{ installed: boolean; proxy: string | null }> {
  const proxy =
    process.env['HTTPS_PROXY'] ??
    process.env['https_proxy'] ??
    process.env['HTTP_PROXY'] ??
    process.env['http_proxy'] ??
    null;

  if (installed || !proxy) return { installed, proxy };

  try {
    // Imported lazily: undici ships with Node, and nothing should pay for it
    // on a deploy that has direct egress.
    const { EnvHttpProxyAgent, setGlobalDispatcher } = await import('undici');
    setGlobalDispatcher(new EnvHttpProxyAgent());
    installed = true;
  } catch {
    // Better to make direct calls and fail loudly on a blocked egress than to
    // refuse to start because a proxy agent could not be loaded.
    return { installed: false, proxy };
  }

  return { installed, proxy };
}
