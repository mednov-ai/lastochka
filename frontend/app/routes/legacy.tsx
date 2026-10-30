import { Link } from 'react-router';
export default function Legacy() {
  return (
    <main id="main" className="page">
      <h1>Теперь можно оставить заявку без аккаунта</h1>
      <p>Прежние кабинеты, регистрация и ссылки из писем больше не используются.</p>
      <Link className="button" to="/enquiry">
        Оставить заявку
      </Link>
    </main>
  );
}
