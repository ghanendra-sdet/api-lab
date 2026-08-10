import { HTTP_METHODS, type HttpMethod } from "@api-lab/shared";
import { methodTextClass } from "../../lib/methodStyles";

interface MethodSelectorProps {
  value: HttpMethod;
  onChange: (method: HttpMethod) => void;
}

export function MethodSelector({ value, onChange }: MethodSelectorProps) {
  return (
    <div className="relative shrink-0">
      <label htmlFor="method-select" className="sr-only">
        HTTP method
      </label>
      <select
        id="method-select"
        value={value}
        onChange={(e) => onChange(e.target.value as HttpMethod)}
        className={`h-9 appearance-none rounded-l-md border border-neutral-200 bg-white pl-3 pr-7 text-sm font-bold hover:border-neutral-300 focus-visible:border-transparent dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700 ${methodTextClass(value)}`}
      >
        {HTTP_METHODS.map((method) => (
          <option key={method} value={method} className="text-neutral-900 dark:text-neutral-100">
            {method}
          </option>
        ))}
      </select>
      <span
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-400"
        aria-hidden="true"
      >
        ▾
      </span>
    </div>
  );
}
