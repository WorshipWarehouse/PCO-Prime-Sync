import type { ReactNode } from 'react';

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-header">
          {title ? <h2>{title}</h2> : <span />}
          {actions}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';

export function Badge({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function statusTone(status: string): Tone {
  switch (status) {
    case 'authenticated':
    case 'in_sync':
    case 'matched':
    case 'success':
    case 'applied':
    case 'yes':
      return 'ok';
    case 'needs_login':
    case 'needs_matching':
    case 'ambiguous':
    case 'partial':
    case 'planned':
    case 'unknown':
    case 'pending':
      return 'warn';
    case 'error':
    case 'failed':
    case 'blocked':
    case 'missing_in_pco':
    case 'no':
    case 'unmatched':
      return 'bad';
    case 'dry_run':
    case 'review':
      return 'info';
    default:
      return 'muted';
  }
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{status.replace(/_/g, ' ')}</Badge>;
}

export function Button({
  children,
  onClick,
  disabled,
  variant = 'secondary',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  type?: 'button' | 'submit';
}) {
  return (
    <button className={`button button-${variant}`} onClick={onClick} disabled={disabled} type={type}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="banner banner-error" role="alert">
      {message}
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return <div className="banner banner-info">{children}</div>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <p className="spinner">{label}</p>;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
