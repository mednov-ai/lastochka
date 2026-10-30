export function Pager({
  label,
  page,
  total,
  size,
  onChange,
}: {
  label: string;
  page: number;
  total: number;
  size: number;
  onChange: (page: number) => void;
}) {
  if (total <= size && page === 0) return null;
  return (
    <nav className="toolbar" aria-label={`${label}: страницы`}>
      <button className="button light" disabled={page === 0} onClick={() => onChange(page - 1)}>
        Назад
      </button>
      <span>
        {label}: страница {page + 1} из {Math.max(1, Math.ceil(total / size))}
      </span>
      <button
        className="button light"
        disabled={(page + 1) * size >= total}
        onClick={() => onChange(page + 1)}
      >
        Далее
      </button>
    </nav>
  );
}
