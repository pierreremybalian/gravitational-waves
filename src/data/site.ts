// Site-wide copy and SEO.
export const SITE = {
  name: 'Gravitational Waves',
  url: 'https://gravitational-waves.balian.dev',
  title: 'Gravitational Waves — Hear LIGO’s first black hole collision, and every merger since',
  description:
    'In 2015 LIGO heard two black holes collide 1.3 billion light years away. Hear the real chirp, see how a stretch a thousand times smaller than a proton was measured and pulled out of the noise, then explore every confirmed merger.',
  ogImage: '/og.jpg',
  ogImageAlt: 'Gravitational Waves: two black holes spiralling together while the real LIGO chirp rises across a glowing waveform.',
  themeColor: '#04030a',
  author: 'Balian Design',
  /** Google Analytics 4 (the balian.dev property). Loaded in production builds only. */
  gaId: 'G-MXMS8L0Z1H',
  /** Companion pieces. */
  cosmicHistory: 'https://cosmic-history.balian.dev',
  blockUniverse: 'https://block-universe.balian.dev',
  tideMachine: 'https://tide-machine.balian.dev',
  crossRhythm: 'https://cross-rhythm.balian.dev',
};

export const STATUS_LABEL = {
  measured: 'Measured',
  established: 'Established',
  modelled: 'Modelled',
  metaphor: 'Metaphor',
} as const;

export const STATUS_HELP = {
  measured:
    'Straight from the detectors’ public data or the published analysis of it: the recordings, the noise, the timing, the fitted masses and distances, with their uncertainties.',
  established:
    'Textbook physics tested many times over: general relativity’s description of gravity and waves, and how an interferometer works.',
  modelled:
    'Computed from a model fitted to the data (a numerical-relativity or effective-one-body waveform, an orbit from Kepler’s law). It matches the measurement but is not the measurement itself.',
  metaphor: 'A picture to help intuition; it claims nothing literal.',
} as const;

export const CREDITS: { label: string; text: string; url?: string }[] = [
  {
    label: 'Data',
    text: 'LIGO Scientific Collaboration, Virgo Collaboration and KAGRA, Gravitational Wave Open Science Center (GWOSC), CC BY 4.0: GW150914 strain from LIGO Hanford and Livingston, the best-fit and numerical-relativity waveforms published with it, and the GWTC event catalogue.',
    url: 'https://gwosc.org',
  },
  {
    label: 'The detection',
    text: 'B. P. Abbott et al. (LIGO Scientific Collaboration and Virgo Collaboration) (2016), Observation of Gravitational Waves from a Binary Black Hole Merger, Physical Review Letters 116, 061102.',
    url: 'https://doi.org/10.1103/PhysRevLett.116.061102',
  },
  {
    label: 'Signal processing',
    text: 'Whitening, band-pass and matched filtering follow GWOSC’s GW150914 tutorial; LIGO Scientific Collaboration and Virgo Collaboration (2020), A guide to LIGO–Virgo detector noise and extraction of transient gravitational-wave signals, Classical and Quantum Gravity 37, 055002.',
    url: 'https://doi.org/10.1088/1361-6382/ab685e',
  },
  {
    label: 'Sound',
    text: 'The chirps are the detectors’ whitened, band-passed strain played at its real speed; where a stage says “pitch raised”, every frequency is multiplied by four with the timing unchanged, so small speakers can play it.',
  },
  {
    label: 'Rendering',
    text: 'three.js WebGPU renderer and TSL shaders, Lenis smooth scroll, Astro.',
    url: 'https://threejs.org/',
  },
];
