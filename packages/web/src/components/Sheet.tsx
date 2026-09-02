import { useEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { SPRING, DURATION, CURVE } from '../lib/motion.ts';
import { XIcon } from './icons.tsx';

/**
 * Bottom sheet.
 *
 * The home for everything that is configuration rather than monitoring. A
 * sheet and not a sixth tab on purpose: a tab bar advertises what the app is
 * for, and "settings" is not what this app is for. Things reached from the
 * header are things you go looking for; things in the tab bar are things you
 * are handed.
 *
 * Drag-to-dismiss is downward only, and only past a third of the sheet, so the
 * gesture cannot fight a list being scrolled inside it.
 */
export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}): React.JSX.Element {
  const reduced = useReducedMotion() === true;
  const panel = useRef<HTMLDivElement>(null);

  /* Escape closes, and the page behind must not scroll under the scrim. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  /* Focus moves into the sheet so a keyboard is not left behind on the page. */
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <div className="sheet-layer">
          <motion.button
            type="button"
            className="sheet-scrim"
            aria-label="Close"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.fast / 1000, ease: [...CURVE.standard] }}
          />
          <motion.div
            ref={panel}
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            initial={reduced ? { opacity: 0 } : { y: '100%' }}
            animate={reduced ? { opacity: 1 } : { y: 0 }}
            exit={reduced ? { opacity: 0 } : { y: '100%' }}
            transition={reduced ? { duration: 0 } : SPRING.drawer}
            drag={reduced ? false : 'y'}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_e, info) => {
              const far = info.offset.y > (panel.current?.offsetHeight ?? 400) / 3;
              if (far || info.velocity.y > 600) onClose();
            }}
          >
            <span className="sheet-grip" aria-hidden="true" />
            <header className="sheet-head">
              <h2>{title}</h2>
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
                <XIcon size={17} />
              </button>
            </header>
            <div className="sheet-body">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
