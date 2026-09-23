// Where this build runs. The harness build (dsh plugin) is compiled with
// VITE_DSH_BRIDGE pointing at the host's API; inside the harness the SPA is
// always an iframe of the harness page. Both are static facts of a build
// and a page, so they are constants, not state.

/** This bundle was built for the DeepSeek Harness plugin. */
export const IN_HARNESS = !!import.meta.env.VITE_DSH_BRIDGE;

/** …and is showing inside the harness page right now (an iframe). */
export const IN_HARNESS_FRAME = IN_HARNESS && typeof window !== 'undefined' && window.parent !== window;
