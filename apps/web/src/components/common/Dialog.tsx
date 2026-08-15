import { useEffect, useRef, type ReactNode, type KeyboardEvent } from "react";

/**
 * Accessible modal dialog wrapper (WCAG 2.1 AA / WAI-ARIA Dialog pattern).
 *
 * Guarantees
 * - Focus trap: Tab/Shift+Tab cycle within the dialog only.
 * - Escape to close: calls `onClose`.
 * - Focus restoration: on unmount, focus returns to the element that was
 *   active when the dialog opened.
 * - Initial focus: dialog panel receives focus on mount so that screen
 *   readers announce the dialog title (via aria-labelledby) immediately.
 * - ARIA: role="dialog" by default, aria-modal="true", aria-labelledby={titleId}.
 * - max-h-[90vh]: dialogs never overflow the viewport vertically.
 *
 * Usage:
 *
 *   <Dialog onClose={onClose} titleId="my-title-id" className="w-[30rem] max-w-[92vw] p-4">
 *     <h2 id="my-title-id">Title</h2>
 *     …content…
 *   </Dialog>
 *
 * The `titleId` prop must match an `id` on a heading element inside the
 * dialog — this is what aria-labelledby references.
 *
 * Pass `role="alertdialog"` for a dialog that interrupts the user with a
 * message requiring immediate acknowledgment (e.g. a confirmation before a
 * consequential action) — the WAI-ARIA alertdialog pattern, distinct from an
 * ordinary dialog. Defaults to "dialog" for every other case.
 */

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

interface DialogProps {
  /** Called when the user clicks the backdrop or presses Escape. */
  onClose: () => void;
  /** id of the heading element inside the dialog, for aria-labelledby. Optional if ariaLabel is provided. */
  titleId?: string;
  /** Explicit accessible name for the dialog, for aria-label. Overrides aria-labelledby. */
  ariaLabel?: string;
  /** Additional Tailwind classes for the dialog panel (width, padding, etc). */
  className?: string;
  /** WAI-ARIA role for the dialog panel. Use "alertdialog" for an interrupting
   * confirmation that requires immediate acknowledgment. Defaults to "dialog". */
  role?: "dialog" | "alertdialog";
  children: ReactNode;
}

export function Dialog({ onClose, titleId, ariaLabel, className = "", role = "dialog", children }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  // Capture the currently focused element so we can restore focus on close.
  useEffect(() => {
    triggerRef.current = document.activeElement;
    return () => {
      const t = triggerRef.current;
      if (t instanceof HTMLElement || t instanceof SVGElement) {
        t.focus();
      }
    };
  }, []);

  // Move initial focus into the dialog panel.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key !== "Tab") return;

    const panel = panelRef.current;
    if (!panel) return;

    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter(
      (el) =>
        !el.closest("[aria-hidden='true']") &&
        getComputedStyle(el).display !== "none" &&
        getComputedStyle(el).visibility !== "hidden",
    );

    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (e.shiftKey) {
      if (active === first || active === panel) {
        e.preventDefault();
        last?.focus();
      }
    } else {
      if (active === last || active === panel) {
        e.preventDefault();
        first?.focus();
      }
    }
  }

  return (
    /* Outer overlay — clicking the dark area (but not the panel) closes the
       dialog. We detect this via e.target === e.currentTarget so that clicks
       that land on the panel never trigger onClose.
       Note: the aria-hidden backdrop div is purely visual; the click handler
       lives on the true container div (role is implicit — it is a layout div,
       not a widget). */
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Visual backdrop — aria-hidden, no interaction */}
      <div aria-hidden="true" className="absolute inset-0 bg-black/30" />

      {/* Dialog panel */}
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : titleId}
        tabIndex={-1}
        className={`relative max-h-[90vh] overflow-y-auto rounded-md bg-white shadow-lg outline-none dark:bg-neutral-900 ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
