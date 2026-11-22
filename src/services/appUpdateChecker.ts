export const CURRENT_APP_BUILD_ID: string =
  typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : 'dev';

export const CURRENT_APP_BUILT_AT: string =
  typeof __APP_BUILT_AT__ !== 'undefined' ? __APP_BUILT_AT__ : '';

const APPLIED_BUILD_KEY = 'lgplast_applied_build_v1';
const SW_RELOADED_KEY = 'lgplast_sw_reloaded_build_v1';

export const OFFICIAL_APK_URL = 'https://downtimelog-pro-apk.onrender.com';

export function getCanonicalSharedAppUrl(): string {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return OFFICIAL_APK_URL;
  }
  const host = window.location.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.onrender.com')) {
    return window.location.origin;
  }
  return OFFICIAL_APK_URL;
}

export interface ServerVersionInfo {
  buildId: string;
  builtAt?: string;
}

async function clearRuntimeCaches(): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {}
}

export async function applyLiveAppUpdate(targetBuildId?: string): Promise<void> {
  if (typeof window === 'undefined') return;
  const markId = targetBuildId || `manual_${Date.now()}`;
  try {
    sessionStorage.setItem(APPLIED_BUILD_KEY, markId);
  } catch {}

  await clearRuntimeCaches();

  if ('serviceWorker' in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        regs.map(async (reg) => {
          try {
            if (reg.waiting) {
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
            await reg.update();
          } catch {}
        })
      );
    } catch {}
  }

  try {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('v', markId);
    window.location.replace(nextUrl.toString());
  } catch {
    window.location.reload();
  }
}

export async function fetchServerVersion(): Promise<ServerVersionInfo | null> {
  if (typeof window === 'undefined' || !import.meta.env.PROD || !navigator.onLine) {
    return null;
  }
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<ServerVersionInfo>;
    if (!data || typeof data.buildId !== 'string' || !data.buildId.trim()) return null;
    return {
      buildId: data.buildId.trim(),
      builtAt: data.builtAt,
    };
  } catch {
    return null;
  }
}

export async function checkForLiveServerUpdate(options?: {
  autoReloadIfDifferent?: boolean;
}): Promise<{ updateAvailable: boolean; serverBuildId: string | null }> {
  const server = await fetchServerVersion();
  if (!server) {
    return { updateAvailable: false, serverBuildId: null };
  }

  const isDifferent =
    CURRENT_APP_BUILD_ID !== 'dev' && server.buildId !== CURRENT_APP_BUILD_ID;

  if (!isDifferent) {
    return { updateAvailable: false, serverBuildId: server.buildId };
  }

  if (options?.autoReloadIfDifferent) {
    let alreadyApplied = false;
    try {
      alreadyApplied = sessionStorage.getItem(APPLIED_BUILD_KEY) === server.buildId;
    } catch {}
    if (!alreadyApplied) {
      await applyLiveAppUpdate(server.buildId);
    }
  }

  return { updateAvailable: true, serverBuildId: server.buildId };
}

export function initProductionServiceWorkerAndUpdates(
  onUpdateDetected?: (serverBuildId: string) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  // Clean ?v=... cache-buster param after reload so address bar stays clean
  try {
    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.has('v')) {
      currentUrl.searchParams.delete('v');
      window.history.replaceState({}, '', currentUrl.pathname + currentUrl.search + currentUrl.hash);
    }
  } catch {}

  if (!('serviceWorker' in navigator)) {
    return () => {};
  }

  let cleaned = false;

  const cleanupLegacySw = async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      let cleanedLegacy = false;
      for (const reg of regs) {
        const scriptUrl =
          reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || '';
        const shouldRemoveDevSw = scriptUrl.includes('dev-sw.js');
        const shouldReplacePushSwInProd =
          import.meta.env.PROD && scriptUrl.endsWith('/push-sw.js');
        if (shouldRemoveDevSw || shouldReplacePushSwInProd) {
          await reg.unregister();
          cleanedLegacy = true;
        }
      }
      if (cleanedLegacy) {
        await clearRuntimeCaches();
      }
    } catch {}
  };

  if (!import.meta.env.PROD) {
    cleanupLegacySw().catch(() => {});
    return () => {};
  }

  let refreshingFromSw = false;
  const handleControllerChange = () => {
    if (refreshingFromSw) return;
    let alreadyReloaded = false;
    try {
      alreadyReloaded = sessionStorage.getItem(SW_RELOADED_KEY) === CURRENT_APP_BUILD_ID;
      if (!alreadyReloaded) {
        sessionStorage.setItem(SW_RELOADED_KEY, CURRENT_APP_BUILD_ID);
      }
    } catch {}
    if (alreadyReloaded) return;
    refreshingFromSw = true;
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

  const registerProdSw = async () => {
    await cleanupLegacySw();
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      });
      reg.update().catch(() => {});
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            if (reg.waiting) {
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
          }
        });
      });
    } catch {}
  };

  if (document.readyState === 'complete') {
    registerProdSw().catch(() => {});
  } else {
    window.addEventListener(
      'load',
      () => {
        if (!cleaned) registerProdSw().catch(() => {});
      },
      { once: true }
    );
  }

  // Immediate startup version check (auto-reloads once if older cached shell booted)
  const bootTimer = setTimeout(() => {
    checkForLiveServerUpdate({ autoReloadIfDifferent: true }).then((res) => {
      if (res.updateAvailable && res.serverBuildId && onUpdateDetected) {
        onUpdateDetected(res.serverBuildId);
      }
    });
  }, 1500);

  let lastCheckAt = 0;
  const runMidSessionCheck = () => {
    const now = Date.now();
    if (now - lastCheckAt < 45000) return;
    lastCheckAt = now;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => r.update().catch(() => {})))
        .catch(() => {});
    }
    checkForLiveServerUpdate({ autoReloadIfDifferent: true }).then((res) => {
      if (res.updateAvailable && res.serverBuildId && onUpdateDetected) {
        onUpdateDetected(res.serverBuildId);
      }
    });
  };

  const handleVis = () => {
    if (document.visibilityState === 'visible') {
      runMidSessionCheck();
    }
  };

  const pollTimer = setInterval(runMidSessionCheck, 60000);
  window.addEventListener('focus', runMidSessionCheck);
  window.addEventListener('online', runMidSessionCheck);
  document.addEventListener('visibilitychange', handleVis);

  return () => {
    cleaned = true;
    clearTimeout(bootTimer);
    clearInterval(pollTimer);
    navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    window.removeEventListener('focus', runMidSessionCheck);
    window.removeEventListener('online', runMidSessionCheck);
    document.removeEventListener('visibilitychange', handleVis);
  };
}
