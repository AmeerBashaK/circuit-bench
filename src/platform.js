// Which kind of device the app runs on. The Android app (and any touch-first screen) gets separate Select and
// Pan tools and a fixed-height code editor; the desktop app and the website keep drag-to-pan, Shift+drag to box-select.
export const touchUI = (() => {
  try {
    return !!window.Capacitor?.isNativePlatform?.() || window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
})();
