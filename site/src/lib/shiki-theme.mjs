// A Shiki theme whose colours are CSS custom properties, so code blocks follow
// the site palette in both the paper (light) and lightbox (dark) themes.
const v = (name) => `var(--code-${name})`;

/** @type {import('shiki').ThemeRegistration} */
export const galleyTheme = {
  name: 'galley',
  type: 'light',
  fg: v('ink'),
  bg: v('paper'),
  colors: {
    'editor.foreground': v('ink'),
    'editor.background': v('paper'),
  },
  tokenColors: [
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: v('comment'), fontStyle: 'italic' } },
    {
      scope: ['keyword', 'storage', 'support.function.be.latex', 'keyword.control', 'support.function.general.tex', 'support.function'],
      settings: { foreground: v('keyword') },
    },
    {
      scope: ['entity.name.function', 'support.function.section.latex', 'entity.name.section', 'markup.heading'],
      settings: { foreground: v('keyword'), fontStyle: 'bold' },
    },
    { scope: ['string', 'markup.inline.raw', 'constant.other.reference.citation.latex', 'constant.other.citation.latex'], settings: { foreground: v('string') } },
    {
      scope: ['constant', 'constant.numeric', 'variable.parameter', 'entity.name.tag', 'support.class.latex', 'variable.parameter.function.latex'],
      settings: { foreground: v('constant') },
    },
    { scope: ['variable', 'meta.object-literal.key', 'support.type.property-name', 'entity.other.attribute-name'], settings: { foreground: v('ink') } },
    { scope: ['punctuation', 'meta.brace', 'punctuation.definition'], settings: { foreground: v('punct') } },
    { scope: ['invalid', 'markup.deleted'], settings: { foreground: v('error') } },
    { scope: ['markup.inserted'], settings: { foreground: v('string') } },
    { scope: ['markup.bold'], settings: { fontStyle: 'bold' } },
    { scope: ['markup.italic'], settings: { fontStyle: 'italic' } },
  ],
};
