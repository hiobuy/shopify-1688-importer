import { Link } from "react-router";
import type { ReactNode } from "react";
export function PageHeader({
  title,
  subtitle,
  backTo,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  backTo?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="page-title">
          {backTo && (
            <Link className="button back" to={backTo} aria-label="Back">
              ←
            </Link>
          )}
          <h1>{title}</h1>
        </div>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
