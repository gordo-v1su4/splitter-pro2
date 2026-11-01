import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'

export function StoryboardSelect({ label, value, options, onChange }: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const [active, setActive] = useState(selectedIndex)
  useEffect(() => {
    if (!open) return
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  function choose(index: number) {
    onChange(options[index].value)
    setOpen(false)
  }

  return (
    <div className="sb-select" ref={root}>
      <span className="sb-select-label" id={`${id}-label`}>{label}</span>
      <button type="button" role="combobox" aria-labelledby={`${id}-label`} aria-expanded={open}
        aria-controls={`${id}-options`} aria-haspopup="listbox"
        aria-activedescendant={open ? `${id}-option-${active}` : undefined}
        onClick={() => { setActive(selectedIndex); setOpen(!open) }}
        onBlur={(event) => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) setOpen(false) }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const step = event.key === 'ArrowDown' ? 1 : -1
            setActive(open ? (active + step + options.length) % options.length : selectedIndex)
            setOpen(true)
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault(); setActive(event.key === 'Home' ? 0 : options.length - 1); setOpen(true)
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            if (open) choose(active)
            else { setActive(selectedIndex); setOpen(true) }
          } else if (event.key === 'Escape' || event.key === 'Tab') setOpen(false)
        }}>
        {options[selectedIndex].label}<ChevronDown size={12} aria-hidden="true" />
      </button>
      {open ? <div className="sb-select-options" id={`${id}-options`} role="listbox" aria-label={label}>
        {options.map((option, index) => <button key={option.value} type="button" role="option"
          id={`${id}-option-${index}`} aria-selected={value === option.value} tabIndex={-1}
          className={active === index ? 'is-active' : ''}
          onPointerMove={() => setActive(index)} onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(index)}>
          {option.label}{value === option.value ? <Check size={12} aria-hidden="true" /> : null}
        </button>)}
      </div> : null}
    </div>
  )
}
