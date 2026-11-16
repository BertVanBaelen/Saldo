import { describe, expect, it } from 'vitest';
import { ALL_EMOJI, DEFAULT_EMOJI, EMOJI_GROUPS, categoryEmoji, lastEmoji, oneEmoji, sameEmoji, searchEmoji } from './emoji';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const parts = (s: string) => [...segmenter.segment(s)].map((x) => x.segment);
const bare = (s: string) => s.replace(/️/g, '');

// The icons migration 0009 writes for the 49 default categories: all must be in the grid so the picker marks them.
const DEFAULTS = '🏠🛒🚗⛽🚌🚆🚲✈️⚡💧🔥📶📱📺🏥💊🏋️🍽️☕🍺🎁🎓📚🧒🐾👜👕✂️🔧🔁👛💼↩️🐷🏦🧾🛡️❤️🎵🎬🎮📷💻🌳🎟️🏨🏛️🏷️📦';

describe('oneEmoji', () => {
  it('accepts one emoji, a ZWJ family, a flag, a keycap and a variation-selector emoji', () => {
    for (const ok of ['🏠', '👨‍👩‍👧', '🇧🇪', '1️⃣', '🏷️', '🏷', ' ☕ ']) expect(oneEmoji(ok)).toBe(ok.trim());
  });

  it('refuses letters, several emoji, a lone digit and empty text', () => {
    for (const bad of ['ab', 'a', '😀😀', '😀 😀', '1', '', '   ', 'home']) expect(oneEmoji(bad)).toBeNull();
  });
});

describe('lastEmoji', () => {
  it('takes the newest emoji of the text, a ZWJ family and a flag as one', () => {
    expect(lastEmoji('🏠🙂')).toBe('🙂');
    expect(lastEmoji('🏠👨‍👩‍👧')).toBe('👨‍👩‍👧');
    expect(lastEmoji('🥳🇧🇪')).toBe('🇧🇪');
    expect(lastEmoji('🏠')).toBe('🏠');
  });

  it('is null when the text does not end in an emoji', () => {
    for (const bad of ['ab', '🏠a', '', ' ']) expect(lastEmoji(bad)).toBeNull();
  });
});

describe('categoryEmoji', () => {
  it('draws the stored emoji or the default tag', () => {
    expect(categoryEmoji('🏠')).toBe('🏠');
    expect(categoryEmoji(null)).toBe(DEFAULT_EMOJI);
    expect(categoryEmoji(undefined)).toBe(DEFAULT_EMOJI);
    expect(categoryEmoji('')).toBe(DEFAULT_EMOJI);
  });

  it('compares with or without the variation selector', () => {
    expect(sameEmoji('✈️', '✈')).toBe(true);
    expect(sameEmoji('✈️', '🚗')).toBe(false);
  });
});

describe('the curated list', () => {
  it('has about 200 emoji, every one a single valid grapheme', () => {
    expect(ALL_EMOJI.length).toBeGreaterThanOrEqual(180);
    for (const x of ALL_EMOJI) {
      expect(parts(x.emoji), x.label).toHaveLength(1);
      expect(oneEmoji(x.emoji), x.label).toBe(x.emoji);
    }
  });

  it('has no duplicate emoji or names, and the ten groups', () => {
    expect(new Set(ALL_EMOJI.map((x) => bare(x.emoji))).size).toBe(ALL_EMOJI.length);
    expect(new Set(ALL_EMOJI.map((x) => x.label)).size).toBe(ALL_EMOJI.length);
    expect(EMOJI_GROUPS.map((g) => g.title)).toEqual([
      'Geld en rekeningen',
      'Wonen',
      'Eten en drinken',
      'Boodschappen',
      'Vervoer',
      'Vrije tijd en reizen',
      'Gezondheid en sport',
      'Kinderen en dieren',
      'Werk en school',
      'Diversen',
    ]);
  });

  it('holds the 49 emoji of the default categories', () => {
    const have = new Set(ALL_EMOJI.map((x) => bare(x.emoji)));
    const wanted = parts(DEFAULTS).map(bare);
    expect(wanted).toHaveLength(49);
    expect(wanted.filter((w) => !have.has(w))).toEqual([]);
  });
});

describe('searchEmoji', () => {
  it('finds Dutch names and search words and drops empty groups', () => {
    const names = (q: string) => searchEmoji(q).flatMap((g) => g.items.map((x) => x.label));
    expect(names('huis')).toContain('Huis');
    expect(names('huis')).not.toContain('Auto');
    expect(names('SKIEN')).toContain('Skiën');
    expect(names('benzine')).toEqual(['Brandstof']);
    expect(searchEmoji('benzine')).toHaveLength(1);
    expect(searchEmoji('zzzz')).toEqual([]);
    expect(searchEmoji('  ')).toBe(EMOJI_GROUPS);
  });
});
