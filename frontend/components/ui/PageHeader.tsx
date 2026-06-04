interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export default function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between px-8 pt-8 pb-5 border-b border-hairline bg-canvas">
      <div>
        <h1 className="text-[22px] font-medium text-ink leading-tight">{title}</h1>
        {subtitle && <p className="text-body-md text-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
