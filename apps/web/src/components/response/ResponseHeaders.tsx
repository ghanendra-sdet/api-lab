interface ResponseHeadersProps {
  headers: Record<string, string>;
}

export function ResponseHeaders({ headers }: ResponseHeadersProps) {
  const entries = Object.entries(headers);

  if (entries.length === 0) {
    return <p className="p-4 text-sm text-neutral-500 dark:text-neutral-400">No response headers.</p>;
  }

  return (
    <div className="overflow-auto p-4">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Response headers</caption>
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
            <th scope="col" className="py-1.5 pr-4 font-medium">
              Key
            </th>
            <th scope="col" className="py-1.5 font-medium">
              Value
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key} className="border-b border-neutral-100 dark:border-neutral-900">
              <td className="py-1.5 pr-4 font-mono text-neutral-600 dark:text-neutral-300">{key}</td>
              <td className="py-1.5 font-mono text-neutral-800 dark:text-neutral-100">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
