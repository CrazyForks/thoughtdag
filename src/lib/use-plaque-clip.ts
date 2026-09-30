// A map plaque never outgrows the footprint the layout reserved for its node; the ladder text past
// that is clipped under a fade (index.css [data-plaque-line][data-clipped]) and one zoom step in
// shows the rest. A DOM mark, not state: the fade is a paint detail the layout never reads.
import { useLayoutEffect, type RefObject } from 'react';

export function usePlaqueClip(ref: RefObject<HTMLDivElement | null>, live: boolean, cap: number, ladder: unknown): void {
  useLayoutEffect(() => {
    const wrap = ref.current; const host = wrap?.firstElementChild as HTMLElement | null;
    if (!live || !wrap || !host) return;
    const check = () => { if (host.offsetHeight > wrap.clientHeight + 1) wrap.dataset.clipped = ''; else delete wrap.dataset.clipped; };
    check();
    const ro = new ResizeObserver(check); ro.observe(host); ro.observe(wrap);
    return () => { ro.disconnect(); delete wrap.dataset.clipped; };
  }, [ref, live, cap, ladder]);
}
