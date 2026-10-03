"use client";

import { useMemo, useRef, useState } from "react";

interface SearchSuggestionsProps {
  value: string;
  onChange: (value: string) => void;
  suggestions?: string[];
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  maxSuggestions?: number;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi")
    .trim();
}

export default function SearchSuggestions({
  value,
  onChange,
  suggestions = [],
  placeholder,
  ariaLabel,
  className = "",
  maxSuggestions = 7,
}: SearchSuggestionsProps) {
  const [focused, setFocused] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyword = normalize(value);

  const options = useMemo(() => {
    const seen = new Set<string>();
    return suggestions
      .map((item) => String(item || "").trim())
      .filter((item) => {
        const key = normalize(item);
        if (!key || seen.has(key) || (keyword && !key.includes(keyword))) return false;
        seen.add(key);
        return true;
      })
      .slice(0, maxSuggestions);
  }, [keyword, maxSuggestions, suggestions]);

  const selectOption = (option: string) => {
    onChange(option);
    setHighlighted(-1);
    setFocused(false);
  };

  return (
    <div className="relative min-w-0">
      <input
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setHighlighted(-1);
        }}
        onFocus={() => {
          if (blurTimer.current) clearTimeout(blurTimer.current);
          setFocused(true);
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setFocused(false), 120);
        }}
        onKeyDown={(event) => {
          if (!focused || options.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlighted((current) => (current + 1) % options.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlighted((current) => (current - 1 + options.length) % options.length);
          } else if (event.key === "Enter" && highlighted >= 0) {
            event.preventDefault();
            selectOption(options[highlighted]);
          } else if (event.key === "Escape") {
            setFocused(false);
            setHighlighted(-1);
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        className={className}
      />
      {focused && options.length > 0 && (
        <div role="listbox" className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          {options.map((option, index) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={highlighted === index}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectOption(option)}
              className={`block w-full truncate px-3 py-2 text-left text-sm ${highlighted === index ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300" : "text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.05]"}`}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
