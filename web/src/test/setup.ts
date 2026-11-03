import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// Busy machines and CI runners are slower than a developer laptop: give findBy/waitFor more time.
configure({ asyncUtilTimeout: 4000 });

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
});

// jsdom does not implement scrolling.
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
