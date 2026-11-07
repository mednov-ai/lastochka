export function headers() {
  return {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  };
}

export function meta() {
  return [
    { title: 'Тестовая оплата — Ласточка' },
    { name: 'referrer', content: 'no-referrer' },
    { name: 'robots', content: 'noindex, nofollow' },
  ];
}

export default function PaymentTestReturn() {
  return (
    <main id="main" className="page">
      <p className="eyebrow">Тестовая оплата</p>
      <h1>Возврат после тестовой оплаты</h1>
      <p>
        Это тестовая страница. Сам переход на неё не подтверждает оплату. Чтобы уточнить результат,
        обратитесь к администратору.
      </p>
      <a className="button" href={import.meta.env.BASE_URL} rel="noreferrer">
        На главную
      </a>
    </main>
  );
}
