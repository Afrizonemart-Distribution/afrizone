import {
  Select as ShadcnSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/shadcn/select'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
  /** Shown but not pickable, e.g. a country that is coming soon. */
  disabled?: boolean
}

interface Props {
  id?: string
  value: string
  onChange: (v: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
  /** Required when there is no associated <Label>, e.g. a toolbar filter. */
  ariaLabel?: string
}

/**
 * Radix Select behind an options-array API, so migrating from `<select>` is a
 * one-for-one swap at the call site rather than four nested components.
 *
 * This is the one form primitive with a visible reason to exist: a native
 * select renders its popup as an OS widget that cannot be styled, so on the
 * sand palette it was the only control that did not match the rest of the
 * interface. Sized to 44px like the other inputs.
 */
export default function Select({
  id,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className = '',
  ariaLabel,
}: Props) {
  return (
    <ShadcnSelect value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          'h-11 w-full rounded-[var(--r-sm)] border-[var(--line-2)] bg-[var(--surface)] px-[14px] text-[14px] shadow-none',
          'focus-visible:border-[var(--clay-deep)]',
          className,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="rounded-[var(--r-sm)] rounded-tr-[var(--cut)] border-[var(--line)] bg-[var(--surface-3)]">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled} className="text-[14px]">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </ShadcnSelect>
  )
}
