// Site-wide copy and SEO.
export const SITE = {
  name: 'Cross Rhythm',
  url: 'https://cross-rhythm.balian.dev',
  title: 'Cross Rhythm — Polyrhythm, polymeter, and why rhythm turns into harmony',
  description:
    'Hear three against two, then see it: rings on one axle, gears that share a beat, a knot that closes every bar. Speed a rhythm up until it becomes a chord, then build your own on a playable instrument.',
  ogImage: '/og.jpg',
  ogImageAlt: 'Cross Rhythm: glowing rings of three and two beats turning on one axle around a sweeping hand.',
  themeColor: '#04030a',
  author: 'Balian Design',
  /** Google Analytics 4 (the balian.dev property). Loaded in production builds only. */
  gaId: 'G-MXMS8L0Z1H',
  /** Companion pieces. */
  cosmicHistory: 'https://cosmic-history.balian.dev',
  blockUniverse: 'https://block-universe.balian.dev',
  tideMachine: 'https://tide-machine.balian.dev',
};

export const STATUS_LABEL = {
  exact: 'Exact',
  measured: 'Measured',
  convention: 'Convention',
  tradition: 'Tradition',
  historical: 'Historical',
  metaphor: 'Metaphor',
} as const;

export const STATUS_HELP = {
  exact: 'Follows from arithmetic: ratios, least common multiples, even spacing. The sound is generated from the same numbers.',
  measured: 'From experiments on how people hear and tap rhythm; the numbers are typical values with real spread between listeners.',
  convention: 'How musicians name and write it down; usage varies between traditions and teachers.',
  tradition: 'Where this lives in real music. Our version is a simplified model of a living practice, not a transcription.',
  historical: 'Documented history of instruments and ideas.',
  metaphor: 'A picture to help intuition; it claims nothing literal.',
} as const;

export const CREDITS: { label: string; text: string; url?: string }[] = [
  {
    label: 'Even rhythms',
    text: 'Godfried Toussaint (2005), The Euclidean Algorithm Generates Traditional Musical Rhythms, Proceedings of BRIDGES; E. Bjorklund’s spacing algorithm.',
    url: 'https://cgm.cs.mcgill.ca/~godfried/publications/banff.pdf',
  },
  {
    label: 'Hearing in time',
    text: 'Justin London (2012), Hearing in Time: Psychological Aspects of Musical Meter, 2nd ed., Oxford University Press.',
  },
  {
    label: 'Shapes view',
    text: 'Inspired by MUSEONG’s “Poly Rhythms” video, which draws each rhythm as a polygon traced by a moving dot.',
    url: 'https://www.youtube.com/watch?v=Lxs4cvSximc',
  },
  {
    label: 'Sound',
    text: 'Every sound is synthesized in your browser with the Web Audio API; no recordings are used.',
  },
  {
    label: 'Rendering',
    text: 'three.js WebGPU renderer and TSL shaders, Lenis smooth scroll, Astro.',
    url: 'https://threejs.org/',
  },
];
