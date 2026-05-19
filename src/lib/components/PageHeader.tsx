import { ReactNode } from 'react';

interface Props {
  title: string;
  breadcrumb?: { label: string; href?: string }[];
  action?: ReactNode;
}

export function PageHeader({ title, breadcrumb, action }: Props) {
  return (
    <div className="flex items-center justify-between py-3 px-4 border-b border-gray-100 bg-white">
      <div>
        {breadcrumb && breadcrumb.length > 0 && (
          <div className="flex items-center gap-1 text-[11px] text-gray-400 uppercase tracking-wide mb-0.5">
            {breadcrumb.map((item, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span>/</span>}
                {item.href ? (
                  <a href={item.href} className="hover:text-gray-600">{item.label}</a>
                ) : (
                  <span>{item.label}</span>
                )}
              </span>
            ))}
          </div>
        )}
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
