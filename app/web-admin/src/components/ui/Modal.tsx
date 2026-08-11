import type { ReactNode } from 'react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/dialog'
import Icon from '../Icon'

interface Props {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
}

/**
 * Branded wrapper over the shadcn/Radix Dialog.
 *
 * The props are unchanged from the hand-rolled version this replaces, so every
 * call site stays as-is — but Radix now supplies the things the old markup was
 * missing: a real focus trap, focus restored to the trigger on close, inert
 * background content for screen readers, and scroll-lock that survives nested
 * dialogs.
 *
 * The look is the same too. shadcn's stock dialog is centred and fixed-height;
 * the classes below restore the top-aligned, self-scrolling sheet the admin
 * already used (long forms like "New task" overflow the viewport), plus the
 * `--r`/`--cut` "Sunrise Cut" corner pair and the glass surface from
 * `tokens.css`. The values are the ones the hand-rolled `.modal` CSS used, so
 * the dialog should render pixel-for-pixel as before.
 */
export default function Modal({ open, title, subtitle, onClose, children }: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        // Radix warns when a dialog has no description; opt out explicitly for
        // the subtitle-less ones rather than shipping an empty description node.
        {...(subtitle ? {} : { 'aria-describedby': undefined })}
        className="top-12 max-h-[calc(100dvh-96px)] w-full max-w-[calc(100%-36px)] translate-y-0 gap-0 overflow-y-auto rounded-[var(--r)] rounded-tr-[var(--cut)] border-border bg-card p-[26px] shadow-[var(--shadow)] data-[state=open]:slide-in-from-top-4 sm:max-w-[620px]"
      >
        <DialogHeader className="mb-5 flex-row items-start justify-between gap-4 text-left sm:text-left">
          <div>
            <DialogTitle className="text-[21px] font-extrabold leading-[1.12] tracking-[-0.02em]">
              {title}
            </DialogTitle>
            {subtitle && (
              <DialogDescription className="mt-1 text-[13px]">{subtitle}</DialogDescription>
            )}
          </div>
          <DialogClose
            className="btn btn-glass btn-sm shrink-0"
            style={{ width: 38, height: 38, padding: 0, minHeight: 38 }}
            aria-label="Close"
          >
            <Icon name="x" />
          </DialogClose>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
