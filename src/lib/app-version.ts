// The desktop shell hands its version to the web layer in the URL (?dv=).
// The web build has no version of its own: null there.
const params = new URLSearchParams(window.location.search);
export const appVersion: string | null = params.get('dv');
