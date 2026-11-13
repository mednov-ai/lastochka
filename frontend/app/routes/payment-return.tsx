export { headers } from './payment-test-return';

export function meta() {
  return [
    { title: 'Возврат после оплаты — Ласточка' },
    { name: 'referrer', content: 'no-referrer' },
    { name: 'robots', content: 'noindex, nofollow' },
  ];
}

export default function PaymentReturn() {
  return (
    <main id="main" className="page">
      <h1>Возврат после оплаты</h1>
      <p>
        Сам переход на эту страницу не подтверждает оплату. Чтобы уточнить результат, обратитесь к
        администратору.
      </p>
      <a className="button" href={import.meta.env.BASE_URL} rel="noreferrer">
        На главную
      </a>
    </main>
  );
}
