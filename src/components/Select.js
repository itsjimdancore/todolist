'use client';
// The app's drop-down: a Headless UI Listbox in place of a native <select>.
// options: [{ value, label, hint?, danger?, divider? }]
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react';
import { CheckIcon, ChevronDownIcon } from '@heroicons/react/20/solid';

export default function Select({ value, onChange, options, label, id, className = '', prefix, placement = 'bottom start', disabled, placeholder = 'Choose…' }) {
  const current = options.find((o) => o.value === value);
  return (
    <Listbox value={value} onChange={onChange} disabled={disabled}>
      <ListboxButton id={id} className={`sel ${className}`} aria-label={label}>
        {prefix && <span className="sel-prefix">{prefix}</span>}
        <span className="sel-value">{current?.label ?? placeholder}</span>
        <ChevronDownIcon className="sel-chev" aria-hidden="true" />
      </ListboxButton>
      <ListboxOptions anchor={{ to: placement, gap: 6, padding: 8 }} transition className="sel-opts" modal={false}>
        {options.map((o) => (
          <ListboxOption key={String(o.value)} value={o.value}
            className={['sel-opt', o.danger && 'danger', o.divider && 'divider'].filter(Boolean).join(' ')}>
            <CheckIcon className="sel-check" aria-hidden="true" />
            <span className="sel-opt-l">{o.label}</span>
            {o.hint && <span className="sel-opt-h">{o.hint}</span>}
          </ListboxOption>
        ))}
      </ListboxOptions>
    </Listbox>
  );
}

// True when an event comes from an open drop-down (its options live in a portal outside the page's popovers),
// so click-away and Escape handlers can leave the popover open
export const inDropdown = (el) => !!el?.closest?.('.sel-opts, [role="listbox"]');
