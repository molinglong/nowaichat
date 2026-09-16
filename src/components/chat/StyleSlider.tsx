'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { getStyleLabel } from '@/lib/ai/style'

interface StyleSliderProps {
  value: number // 0-100
  onChange: (value: number) => void
  label?: string
  className?: string
}

export function StyleSlider({
  value = 50,
  onChange,
  label = '对话风格',
  className,
}: StyleSliderProps) {
  const [localValue, setLocalValue] = useState(value)
  
  const styleLabel = getStyleLabel(localValue)
  
  useEffect(() => {
    setLocalValue(value)
  }, [value])
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseInt(e.target.value, 10)
    setLocalValue(newValue)
    onChange(newValue)
  }
  
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <label className="text-sm font-medium text-content-primary">
        {label}
      </label>
      
      {/* Slider container */}
      <div className="relative px-4 py-2">
        {/* Label badges */}
        <div className="flex justify-between mb-2 text-xs font-medium">
          <span 
            className={cn(
              'transition-colors',
              localValue <= 30 ? 'text-accent font-bold' : 'text-content-secondary'
            )}
          >
            严肃
          </span>
          <span
            className={cn(
              'transition-colors',
              localValue >= 70 ? 'text-accent font-bold' : 'text-content-secondary'
            )}
          >
            幽默
          </span>
        </div>
        
        {/* Slider track with gradient */}
        <div className="relative h-2 bg-content-muted/30 rounded-full">
          {/* Gradient overlay based on value */}
          <div
            className="absolute h-full rounded-full transition-all"
            style={{
              left: '0',
              width: `${localValue}%`,
              background: `linear-gradient(to right, rgba(100, 100, 100, 0.5) ${Math.max(0, (localValue - 30))}%, rgba(168, 85, 247, 0.8) ${Math.max(0, (localValue - 30))}%, 100%)`,
            }}
          />
          
          {/* Slider thumb */}
          <input
            type="range"
            min="0"
            max="100"
            value={localValue}
            onChange={handleChange}
            className="absolute w-full h-full opacity-0 cursor-pointer z-10"
            aria-label="对话风格滑动条"
          />
          
          {/* Visual thumb indicator */}
          <div
            className="absolute h-4 w-4 bg-accent rounded-full shadow-lg transform -translate-y-1/2 pointer-events-none transition-all"
            style={{
              left: `calc(${localValue}% - 8px)`,
              top: '50%',
            }}
          />
        </div>
        
        {/* Position markers */}
        <div className="flex justify-between mt-2 text-[10px] text-content-muted">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>
      
      {/* Current style label */}
      <div className="flex items-center justify-center gap-2">
        <div
          className={cn(
            'px-3 py-1 rounded-full text-xs font-medium transition-colors',
            localValue <= 30
              ? 'bg-gray-500/20 text-gray-400'
              : localValue >= 70
              ? 'bg-purple-500/20 text-purple-400'
              : 'bg-blue-500/20 text-blue-400'
          )}
        >
          {styleLabel}
        </div>
      </div>
    </div>
  )
}
