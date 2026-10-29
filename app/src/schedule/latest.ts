/**
 * For requests that can overlap (a search box fires one per keystroke): each call to the returned
 * function starts a new request and returns a check, "is mine still the newest?". An answer whose
 * check says no arrived late and must be dropped, or an old, slow search would overwrite a newer one.
 */
export function makeLatest() {
  let newest = 0;
  return () => {
    const mine = ++newest;
    return () => mine === newest;
  };
}
