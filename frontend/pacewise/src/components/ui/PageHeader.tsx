import React from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';

export function PageHeader({
  title,
  description,
  actions,
  back,
  eyebrow,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { to: string; label: string };
  eyebrow?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1">
        {back && (
          <Link to={back.to} className="mb-3 inline-flex min-h-[40px] items-center gap-1.5 rounded-lg text-sm font-semibold text-muted hover:text-ink">
            <Icon name="arrowLeft" size={18} />
            {back.label}
          </Link>
        )}
        {eyebrow && <div className="mb-2">{eyebrow}</div>}
        <h1 className="text-[26px] font-bold tracking-tight sm:text-[30px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-col gap-3 sm:flex-row sm:items-center">{actions}</div>}
    </header>
  );
}
