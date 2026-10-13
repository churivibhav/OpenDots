import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

const key = 'opendots-sidebar-folded';

// Storage can be unavailable (private windows, blocked site data); folding then
// lasts for this visit only.
function folded(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}
function remember(id: string, open: boolean) {
  try {
    const rest = folded().filter((item) => item !== id);
    localStorage.setItem(key, JSON.stringify(open ? rest : [...rest, id]));
  } catch {
    // Applies for this visit only.
  }
}

/** A sidebar group that folds away, remembering its state across visits. */
export function SidebarSection({
  id,
  title,
  action,
  children,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => !folded().includes(id));
  const body = `sidebar-section-${id}`;
  return (
    <section className={`sidebar-section ${open ? 'open' : ''}`}>
      <div className="sidebar-section-header nav-label">
        <button
          className="sidebar-section-toggle"
          aria-expanded={open}
          aria-controls={body}
          onClick={() => {
            remember(id, !open);
            setOpen(!open);
          }}
        >
          <ChevronRight size={14} aria-hidden="true" />
          {title}
        </button>
        {action}
      </div>
      {open && (
        <div className="sidebar-section-body" id={body}>
          {children}
        </div>
      )}
    </section>
  );
}
