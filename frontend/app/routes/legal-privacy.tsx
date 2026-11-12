import { LegalDocument } from '../ui/legal-document';

export function meta() {
  return [{ title: 'Политика обработки персональных данных — Ласточка' }];
}

export default function PrivacyPolicy() {
  return <LegalDocument document="privacy" />;
}
