import type {
  ButtonHTMLAttributes,
  ComponentPropsWithoutRef,
  ReactNode,
} from 'react';

import { cn } from '@/lib/cn';

type DivProps = ComponentPropsWithoutRef<'div'>;

type ButtonVariant = 'primary' | 'secondary' | 'muted' | 'accent' | 'ghost';

type ButtonSize = 'sm' | 'md';

const buttonVariantClassName: Record<ButtonVariant, string> = {
  primary:
    'bg-gray-900 text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200',
  secondary:
    'border border-gray-200 bg-white/85 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900/70 dark:text-gray-200 dark:hover:bg-gray-800',
  muted:
    'bg-gray-100/90 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700',
  accent:
    'bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400',
  ghost:
    'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200',
};

const buttonSizeClassName: Record<ButtonSize, string> = {
  sm: 'rounded-lg px-3 py-2 text-xs',
  md: 'rounded-xl px-4 py-2.5 text-sm',
};

const iconBadgeToneClassName = {
  neutral: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200',
  emerald:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200',
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-200',
} as const;

export function AppDialogBackdrop({ className, ...props }: DivProps) {
  return (
    <div
      className={cn('fixed inset-0 bg-black/55 backdrop-blur-md', className)}
      {...props}
    />
  );
}

export function AppDialogPanel({ className, ...props }: DivProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[28px] border border-gray-200/80 bg-white/95 shadow-[0_28px_90px_rgba(15,23,42,0.24)] backdrop-blur-xl dark:border-gray-700/70 dark:bg-gray-900/92',
        className
      )}
      {...props}
    />
  );
}

export function AppDialogHeader({ className, ...props }: DivProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-gray-200/80 px-5 py-4 dark:border-gray-800/80 sm:px-6',
        className
      )}
      {...props}
    />
  );
}

export function AppDialogTitleBlock({
  title,
  subtitle,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 space-y-1', className)}>
      <div className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
        {title}
      </div>
      {subtitle ? (
        <div className='text-sm leading-6 text-gray-500 dark:text-gray-400'>
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

export function AppIconBadge({
  tone = 'neutral',
  className,
  children,
  ...props
}: DivProps & {
  tone?: keyof typeof iconBadgeToneClassName;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex h-10 w-10 items-center justify-center rounded-2xl',
        iconBadgeToneClassName[tone],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function AppSurfaceCard({ className, ...props }: DivProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-gray-200/80 bg-white/85 shadow-sm backdrop-blur-sm dark:border-gray-700/80 dark:bg-gray-900/60',
        className
      )}
      {...props}
    />
  );
}

export function AppButton({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        buttonSizeClassName[size],
        buttonVariantClassName[variant],
        className
      )}
      {...props}
    />
  );
}

export function AppIconButton({
  variant = 'ghost',
  type = 'button',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
}) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        buttonVariantClassName[variant],
        className
      )}
      {...props}
    />
  );
}
