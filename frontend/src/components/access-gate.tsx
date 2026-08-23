import { LoaderCircle, LockKeyhole } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'

type AccessState = 'checking' | 'open' | 'locked'
type SubmitResult = 'accepted' | 'rejected' | 'throttled' | 'error'

async function readAccessState(): Promise<AccessState> {
  try {
    const response = await fetch('/api/access-gate', {
      credentials: 'same-origin',
      cache: 'no-store',
    })
    if (!response.ok) return 'open'
    const status = await response.json() as { required: boolean; unlocked: boolean }
    return !status.required || status.unlocked ? 'open' : 'locked'
  } catch {
    return 'open'
  }
}

async function submitAccessPin(pin: string): Promise<SubmitResult> {
  try {
    const response = await fetch('/api/access-gate', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    })
    if (response.ok) return 'accepted'
    if (response.status === 429) return 'throttled'
    if (response.status === 401) return 'rejected'
    return 'error'
  } catch {
    return 'error'
  }
}

export function AccessGate() {
  const [access, setAccess] = useState<AccessState>('checking')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    void readAccessState().then((next) => {
      if (!active) return
      setAccess(next)
      if (next === 'locked') window.setTimeout(() => inputRef.current?.focus(), 0)
    })
    return () => {
      active = false
    }
  }, [])

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !pin) return
    setBusy(true)
    setError(null)
    const result = await submitAccessPin(pin)
    setBusy(false)

    if (result === 'accepted') {
      setPin('')
      setAccess('open')
      return
    }

    setPin('')
    setError(
      result === 'throttled'
        ? 'Too many attempts. Wait a few minutes.'
        : result === 'rejected'
          ? 'Incorrect access code.'
          : 'Could not reach the access gate. Try again.',
    )
    inputRef.current?.focus()
  }

  if (access === 'open') return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[#050605]/90 p-5 backdrop-blur-xl" role="dialog" aria-modal="true" aria-label="Private access">
      <div className="pointer-events-none absolute inset-0 opacity-[0.035]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.7) 1px, transparent 1px)', backgroundSize: '72px 72px' }} />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_top,rgba(115,173,104,0.12),transparent_65%)]" />

      <form onSubmit={unlock} className="relative w-full max-w-[360px] border border-[#263026] bg-[#0a0c0a]/95 p-5 shadow-[0_28px_100px_rgba(0,0,0,.9),inset_0_1px_0_rgba(190,235,170,.06)] sm:p-6">
        <div className="mb-7 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="grid grid-cols-2 gap-[2px]" aria-hidden="true">
              <span className="h-1.5 w-1.5 bg-[color:var(--color-accent)]" />
              <span className="h-1.5 w-1.5 bg-[#273027]" />
              <span className="h-1.5 w-1.5 bg-[#273027]" />
              <span className="h-1.5 w-1.5 bg-[color:var(--color-accent)]" />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#d5ddd1]">Splitter Studio</p>
              <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.24em] text-[#465046]">Private deployment · Pro 02</p>
            </div>
          </div>
          <span className="flex h-8 w-8 items-center justify-center border border-[#253025] text-[color:var(--color-accent)]">
            <LockKeyhole className="h-3.5 w-3.5" strokeWidth={1.5} />
          </span>
        </div>

        <div className="border-l border-[color:var(--color-accent-line)] pl-4">
          <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-[color:var(--color-accent)]">Access checkpoint</p>
          <h1 className="mt-2 text-[19px] font-medium tracking-[-0.02em] text-[#d8ddd5]">Enter your access code.</h1>
          <p className="mt-2 text-[12px] leading-relaxed text-[#667066]">This workspace is private. A verified session stays unlocked on this browser for 30 days.</p>
        </div>

        {access === 'checking' ? (
          <div className="mt-7 flex h-11 items-center justify-center gap-2 border border-[#202520] bg-[#080a08] font-mono text-[9px] uppercase tracking-[0.2em] text-[#566056]">
            <LoaderCircle className="h-3 w-3 animate-spin text-[color:var(--color-accent)]" />
            Verifying session
          </div>
        ) : (
          <>
            <label htmlFor="splitter-access-code" className="mt-7 block font-mono text-[8px] uppercase tracking-[0.22em] text-[#596359]">Access code</label>
            <input
              ref={inputRef}
              id="splitter-access-code"
              aria-label="Access code"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={128}
              value={pin}
              disabled={busy}
              onChange={(event) => setPin(event.target.value)}
              className="mt-2 h-12 w-full border border-[#303a30] bg-[#070907] px-3 text-center font-mono text-[16px] tracking-[0.45em] text-[#d5e3cf] outline-none transition-colors placeholder:text-[#303830] focus:border-[color:var(--color-accent)]"
              placeholder="••••"
            />
            {error ? <p className="mt-2 font-mono text-[10px] text-red-400" role="alert">{error}</p> : null}
            <button
              type="submit"
              disabled={busy || !pin}
              className="mt-4 flex h-11 w-full items-center justify-center border border-[color:var(--color-accent-line)] bg-[color:var(--color-accent-soft)] font-mono text-[9px] font-medium uppercase tracking-[0.24em] text-[#b9d0b1] transition-colors hover:border-[color:var(--color-accent)] hover:text-[#d5e8cd] disabled:cursor-not-allowed disabled:border-[#252a25] disabled:bg-[#101210] disabled:text-[#434a43]"
            >
              {busy ? <><LoaderCircle className="mr-2 h-3 w-3 animate-spin" /> Checking</> : 'Unlock workspace'}
            </button>
          </>
        )}

        <div className="mt-6 flex items-center justify-between border-t border-[#1c211c] pt-3 font-mono text-[8px] uppercase tracking-[0.17em] text-[#3c443c]">
          <span>Server verified</span>
          <span>HttpOnly session</span>
        </div>
      </form>
    </div>
  )
}
