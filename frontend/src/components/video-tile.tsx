import { Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '../lib/utils'

export interface VideoTileProps {
  src: string
  poster?: string
  ariaLabel?: string
  overlay?: ReactNode
  className?: string
  /** Softer, smaller play/pause affordance (e.g. reference clip view) */
  playStyle?: 'default' | 'subtle'
  onCurrentTimeChange?: (seconds: number) => void
}

export function VideoTile({ src, poster, ariaLabel, overlay, className, playStyle = 'default', onCurrentTimeChange }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(true)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let rafId = 0

    const syncProgress = () => {
      if (!video.duration || !Number.isFinite(video.duration)) return
      setProgress(Math.min(100, Math.max(0, (video.currentTime / video.duration) * 100)))
    }

    const tick = () => {
      if (video.paused) return
      syncProgress()
      rafId = requestAnimationFrame(tick)
    }

    const onPlay = () => {
      setIsPlaying(true)
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(tick)
    }

    const reportCurrentTime = () => onCurrentTimeChange?.(video.currentTime)

    const onPause = () => {
      setIsPlaying(false)
      cancelAnimationFrame(rafId)
      syncProgress()
      reportCurrentTime()
    }

    const onSeeked = () => {
      syncProgress()
      reportCurrentTime()
    }

    const onTimeUpdate = () => {
      syncProgress()
      reportCurrentTime()
    }

    const onLoadStart = () => {
      setIsPlaying(false)
      setProgress(0)
      onCurrentTimeChange?.(0)
    }

    const onEnded = () => {
      setIsPlaying(false)
      cancelAnimationFrame(rafId)
      setProgress(100)
    }

    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('loadstart', onLoadStart)
    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('ended', onEnded)
    video.addEventListener('loadedmetadata', onSeeked)
    return () => {
      cancelAnimationFrame(rafId)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('loadstart', onLoadStart)
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('loadedmetadata', onSeeked)
    }
  }, [onCurrentTimeChange, src])

  function togglePlay() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      void video.play()
    } else {
      video.pause()
    }
  }

  function toggleMute(event: React.MouseEvent) {
    event.stopPropagation()
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setIsMuted(video.muted)
  }

  function handleScrub(event: React.MouseEvent<HTMLDivElement>) {
    event.stopPropagation()
    const video = videoRef.current
    if (!video || !video.duration) return
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - rect.left) / rect.width
    video.currentTime = video.duration * Math.max(0, Math.min(1, ratio))
    setProgress(ratio * 100)
  }

  const subtle = playStyle === 'subtle'

  return (
    <div className={cn('group relative', className)}>
      <div className="relative block aspect-video w-full overflow-hidden bg-black">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          src={src}
          poster={poster}
          muted={isMuted}
          playsInline
          preload="metadata"
        />

        <div
          className={cn(
            'pointer-events-none absolute inset-0 z-[1] transition-opacity duration-200',
            'bg-gradient-to-t from-black/60 via-black/0 to-black/30',
            isPlaying ? 'opacity-0 group-hover:opacity-100' : 'opacity-100',
          )}
        />

        <div className="pointer-events-none absolute inset-0 z-[2]">{overlay}</div>

        <span
          className={cn(
            'pointer-events-none absolute left-1/2 top-1/2 z-[3] flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[2px]',
            'transition-all duration-200',
            subtle
              ? [
                  'h-8 w-8 border border-white/12 bg-black/40 text-[#c0c0c0]/55',
                  'backdrop-blur-[2px]',
                  isPlaying
                    ? 'scale-95 opacity-0 group-hover:opacity-80'
                    : 'scale-100 opacity-90',
                ]
              : [
                  'h-12 w-12 border border-white/30 bg-black/55 text-white',
                  'backdrop-blur-sm',
                  isPlaying
                    ? 'scale-90 opacity-0 group-hover:scale-100 group-hover:opacity-100'
                    : 'scale-100 opacity-100',
                ],
          )}
        >
          {isPlaying ? (
            <Pause className={cn(subtle ? 'h-3 w-3' : 'h-4 w-4')} fill="currentColor" />
          ) : (
            <Play className={cn(subtle ? 'h-3 w-3 translate-x-[0.5px]' : 'h-4 w-4 translate-x-[1px]')} fill="currentColor" />
          )}
        </span>

        <button
          type="button"
          onClick={togglePlay}
          aria-label={ariaLabel ?? (isPlaying ? 'Pause' : 'Play')}
          className="absolute inset-0 z-[4] cursor-pointer border-0 bg-transparent outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--color-accent)]"
        />

        <button
          type="button"
          onClick={toggleMute}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
          className={cn(
            'absolute bottom-3 right-3 z-[5] flex items-center justify-center rounded-sm',
            'transition-all duration-200 hover:text-white',
            subtle
              ? 'h-6 w-6 border border-[#181818] bg-black/45 text-[#777]/80 hover:border-white/20'
              : 'h-7 w-7 border border-white/20 bg-black/55 text-white/90 hover:border-white/40',
            isPlaying ? 'opacity-0 group-hover:opacity-100' : 'opacity-90',
          )}
        >
          {isMuted ? <VolumeX className={subtle ? 'h-2.5 w-2.5' : 'h-3 w-3'} /> : <Volume2 className={subtle ? 'h-2.5 w-2.5' : 'h-3 w-3'} />}
        </button>
      </div>

      <div
        onClick={handleScrub}
        className="relative h-[3px] cursor-pointer bg-white/[0.06]"
        role="slider"
        aria-label="Seek"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={-1}
      >
        <div
          className="absolute inset-y-0 left-0 bg-zinc-500/50"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}
