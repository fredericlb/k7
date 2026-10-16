// back.js — evaluated in the visible studio app on the system Back (AppViewsPlugin.kt); its value says whether the page used it.
// A Radix dialog, sheet, popover or menu pushes no history, so Back closes it with the Escape it already answers to.
// A page may take Back itself: a cancelled `k7:back` event on window counts as used.
(() => {
  const asked = new Event("k7:back", { cancelable: true });
  if (!window.dispatchEvent(asked)) return true;
  const open = document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [aria-modal="true"], [data-radix-popper-content-wrapper], [role="menu"][data-state="open"], [role="listbox"][data-state="open"]',
  );
  if (!open) return false;
  const at =
    document.activeElement && document.activeElement !== document.body
      ? document.activeElement
      : document;
  at.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      bubbles: true,
      cancelable: true,
    }),
  );
  return true;
})();
