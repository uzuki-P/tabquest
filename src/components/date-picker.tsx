"use client"

import { CalendarBlankIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { dateKeyToDate, dateToDateKey, formatDisplayDate } from "@/lib/time"
import { cn } from "@/lib/utils"

interface DatePickerProps {
  id?: string
  /** Selected date as a YYYY-MM-DD key. */
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
}

/**
 * Form-field date picker: a trigger button showing the formatted date plus a
 * shadcn Calendar in a popover. Values are YYYY-MM-DD keys, the project's
 * canonical date format, so callers never touch Date objects.
 */
export function DatePicker({
  id,
  value,
  onChange,
  disabled,
  className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const selected = dateKeyToDate(value) ?? undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            size="lg"
            disabled={disabled}
            className={cn("w-full justify-start font-normal", className)}
          >
            <CalendarBlankIcon data-icon="inline-start" className="size-3.5" />
            {selected ? formatDisplayDate(value) : "Pick a date"}
          </Button>
        }
      />
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            if (!date) return
            onChange(dateToDateKey(date))
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
