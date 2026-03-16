import { lazy, type ComponentType } from 'react';

/**
 * Lazy-load a component with retry logic for chunk loading failures.
 * When deploying a new version, old chunks get deleted — users with the
 * old app open will get chunk loading errors. This retries with exponential
 * backoff, then forces a page reload as a last resort.
 */
export function lazyWithRetry<T extends ComponentType<unknown>>(
  importFn: () => Promise<{ default: T }>,
  retries = 2,
) {
  return lazy(async () => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await importFn();
      } catch (error) {
        if (attempt === retries) {
          // Final attempt failed — force reload to get new chunks
          const hasReloaded = sessionStorage.getItem('chunk-reload');
          if (!hasReloaded) {
            sessionStorage.setItem('chunk-reload', 'true');
            window.location.reload();
          }
          throw error;
        }
        // Wait before retry (exponential backoff)
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    throw new Error('Failed to load page');
  });
}
