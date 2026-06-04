import { clsx } from 'clsx';

export default function LoadingSpinner({ className }: { className?: string }) {
  return (
    <div className={clsx('flex items-center justify-center py-12', className)}>
      <div className="w-7 h-7 border-2 border-hairline border-t-ink rounded-full animate-spin" />
    </div>
  );
}
