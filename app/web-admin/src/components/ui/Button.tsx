import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import Icon, { type IconName } from '../Icon'

type Variant = 'primary' | 'glass' | 'money' | 'danger'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
  icon?: IconName
  loading?: boolean
  children?: ReactNode
}

/**
 * Ref-forwarding is required, not cosmetic: Radix primitives used with
 * `asChild` (e.g. DropdownMenuTrigger in Hiring) hand the trigger a ref to
 * manage focus, aria wiring and outside-click detection. Without it Radix
 * cannot restore focus to the trigger when a menu closes.
 */
const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'glass', size = 'md', icon, loading, children, className = '', disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <span
          className="spinner"
          style={{ width: 16, height: 16, borderWidth: 2 }}
          aria-hidden="true"
        />
      ) : (
        icon && <Icon name={icon} />
      )}
      {children}
    </button>
  )
})

export default Button
