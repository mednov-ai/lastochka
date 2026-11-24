import { Fragment, type CSSProperties } from 'react';

const split = (text: string) => text.trim().split(/\s+/);

/** Heading words with their own masks. The text stays in the server HTML with ordinary spaces. */
export function Words({ text }: { text: string }) {
  return split(text).map((word, index) => (
    <Fragment key={index}>
      {index > 0 && ' '}
      <span className="word" style={{ '--word': index } as CSSProperties}>
        <span>{word}</span>
      </span>
    </Fragment>
  ));
}

export function Phrase({ text }: { text: string }) {
  return split(text).map((word, index) => (
    <Fragment key={index}>
      {index > 0 && ' '}
      <span>{word}</span>
    </Fragment>
  ));
}
