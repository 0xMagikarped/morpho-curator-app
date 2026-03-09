import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils/cn';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function Drawer({ open, onClose, title, subtitle, children, footer }: DrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const motionOk = useRef(true);

  useEffect(() => {
    motionOk.current = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // Focus trap + ESC handler
  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement as HTMLElement;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !drawerRef.current) return;

      const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    // Focus first focusable element
    requestAnimationFrame(() => {
      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      focusable?.[0]?.focus();
    });

    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      previousFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/60',
          motionOk.current ? 'animate-[fade-in_200ms_ease-out]' : '',
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'fixed right-0 top-0 h-full w-full sm:w-[480px] z-50 flex flex-col',
          'bg-bg-surface border-l border-border-subtle',
          motionOk.current ? 'animate-[slide-in-right_250ms_ease-out]' : '',
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-3 border-b border-border-subtle shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-primary truncate">{title}</h2>
            {subtitle && (
              <p className="text-[10px] font-mono text-text-tertiary mt-0.5 truncate">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 -mr-1 -mt-1 text-text-tertiary hover:text-text-primary transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Close drawer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="shrink-0 border-t border-border-subtle p-3">
            {footer}
          </div>
        )}
      </div>
    </>
  );
}
