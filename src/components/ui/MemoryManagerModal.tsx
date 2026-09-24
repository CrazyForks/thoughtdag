import { useUiStore } from '../../lib/ui-store';
import SessionAtlas from '../SessionAtlas';

// The ⋯ menu's "memory" entry: the atlas surface opened on its memory page
// (ThoughtDAG's own library beside the other agents' memory files, the
// why-layer search above both). One surface for what was said and what
// was remembered; the page only sets where it opens.
export default function MemoryManagerModal() {
  const open = useUiStore((s) => s.memoryManagerOpen);
  const setOpen = useUiStore((s) => s.setMemoryManagerOpen);
  if (!open) return null;
  // a canvas switched from here: the canvas component refits (it listens)
  const switched = () => { setOpen(false); window.dispatchEvent(new CustomEvent('td:project-switched')); };
  return <SessionAtlas initialTab="memory" onClose={() => setOpen(false)} onSwitched={switched} />;
}
