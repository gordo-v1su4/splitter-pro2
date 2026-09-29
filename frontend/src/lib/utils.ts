import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Accepts `25:15`, `1:02:30`, `2:00`, `2m`, or a plain number of seconds. */
export function parseClipTimestamp(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const minuteLabel = trimmed.match(/^(\d+(?:\.\d+)?)\s*(?:m|min|mins|minutes)$/i)
  if (minuteLabel) {
    const value = Number(minuteLabel[1]) * 60
    return Number.isFinite(value) && value >= 0 ? value : null
  }
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const value = Number(trimmed)
    return Number.isFinite(value) && value >= 0 ? value : null
  }
  const parts = trimmed.split(':')
  if (parts.length < 2 || parts.length > 3) return null
  if (parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) return null
  const numbers = parts.map(Number)
  if (numbers.some((value) => !Number.isFinite(value) || value < 0)) return null
  const seconds = numbers[numbers.length - 1]
  const minutes = numbers[numbers.length - 2]
  const hours = numbers.length === 3 ? numbers[0] : 0
  if (minutes >= 60 || seconds >= 60) return null
  return hours * 3600 + minutes * 60 + seconds
}

export function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  if (minutes === 0) {
    return `${seconds}s`
  }
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
}
