import { LegalDocument } from '../ui/legal-document';

export function meta() {
  return [{ title: 'Пользовательское соглашение — Ласточка' }];
}

export default function TermsOfUse() {
  return <LegalDocument document="terms" />;
}
