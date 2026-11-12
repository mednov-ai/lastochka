import { Link } from 'react-router';
import documents from '../content/legal-documents.json';

type Block = { type: string; text: string };

export function LegalDocument({ document }: { document: keyof typeof documents }) {
  const [title, ...blocks] = documents[document] as Block[];
  const groups: Array<Block | Block[]> = [];
  for (const block of blocks) {
    const previous = groups[groups.length - 1];
    if (block.type === 'item') {
      if (Array.isArray(previous)) previous.push(block);
      else groups.push([block]);
    } else groups.push(block);
  }

  return (
    <main id="main" className="page legal-document">
      <Link className="legal-home" to="/">
        На главную
      </Link>
      <h1>{title.text}</h1>
      {groups.map((group, index) =>
        Array.isArray(group) ? (
          <ul key={index}>
            {group.map((item, i) => (
              <li key={i}>{item.text}</li>
            ))}
          </ul>
        ) : group.type === 'heading' ? (
          <h2 key={index}>{group.text}</h2>
        ) : (
          <p key={index}>{group.text}</p>
        ),
      )}
    </main>
  );
}
