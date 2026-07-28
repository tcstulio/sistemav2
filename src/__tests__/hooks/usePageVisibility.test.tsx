import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePageVisibility } from '../../hooks/usePageVisibility';

const setVisibility = (value: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
};

describe('usePageVisibility', () => {
  afterEach(() => setVisibility('visible'));

  it('retorna o estado atual e reage a visibilitychange', () => {
    setVisibility('visible');
    const { result } = renderHook(() => usePageVisibility());
    expect(result.current).toBe(true);

    act(() => {
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBe(false);

    act(() => {
      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBe(true);
  });

  it('remove o listener ao desmontar', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => usePageVisibility());
    unmount();
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    remove.mockRestore();
  });
});
