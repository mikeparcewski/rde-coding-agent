import { describe, it, expect } from 'vitest';
import { interpolate, validateParams } from '../dist/loader/template-interpolator.js';

describe('interpolate', () => {
  it('interpolates a single {{param}} placeholder', () => {
    const result = interpolate('Hello, {{name}}!', { name: 'Alice' });
    expect(result).toBe('Hello, Alice!');
  });

  it('interpolates multiple different placeholders', () => {
    const result = interpolate('{{greeting}}, {{name}}! You have {{count}} messages.', {
      greeting: 'Hi',
      name: 'Bob',
      count: 3,
    });
    expect(result).toBe('Hi, Bob! You have 3 messages.');
  });

  it('interpolates the same placeholder appearing multiple times', () => {
    const result = interpolate('{{x}} + {{x}} = ?', { x: '2' });
    expect(result).toBe('2 + 2 = ?');
  });

  it('uses the default value when param is missing — {{param | "default"}}', () => {
    const result = interpolate('Hello, {{name | "World"}}!', {});
    expect(result).toBe('Hello, World!');
  });

  it('prefers the provided value over the default', () => {
    const result = interpolate('Hello, {{name | "World"}}!', { name: 'Alice' });
    expect(result).toBe('Hello, Alice!');
  });

  it('handles empty string default value — {{param | ""}}', () => {
    const result = interpolate('Prefix{{sep | ""}}Suffix', {});
    expect(result).toBe('PrefixSuffix');
  });

  it('leaves unknown params unchanged when no default — {{unknown}}', () => {
    const result = interpolate('Value: {{missing}}', {});
    expect(result).toBe('Value: {{missing}}');
  });

  it('handles a template with no placeholders', () => {
    const result = interpolate('Static content.', { foo: 'bar' });
    expect(result).toBe('Static content.');
  });

  it('handles an empty template', () => {
    const result = interpolate('', { name: 'x' });
    expect(result).toBe('');
  });

  it('converts numeric param values to strings', () => {
    const result = interpolate('Count: {{n}}', { n: 42 });
    expect(result).toBe('Count: 42');
  });

  it('converts boolean param values to strings', () => {
    const result = interpolate('Enabled: {{flag}}', { flag: true });
    expect(result).toBe('Enabled: true');
  });

  it('treats null as missing and uses the default', () => {
    const result = interpolate('{{val | "fallback"}}', { val: null });
    expect(result).toBe('fallback');
  });

  it('treats null as missing and leaves placeholder when no default', () => {
    const result = interpolate('{{val}}', { val: null });
    expect(result).toBe('{{val}}');
  });

  it('handles multi-line templates correctly', () => {
    const template = `# {{title}}

Author: {{author | "Anonymous"}}

{{body}}`;
    const result = interpolate(template, { title: 'My Doc', body: 'Content here.' });
    expect(result).toBe('# My Doc\n\nAuthor: Anonymous\n\nContent here.');
  });

  it('does not interpolate malformed placeholders like {single}', () => {
    const result = interpolate('{name}', { name: 'Alice' });
    expect(result).toBe('{name}');
  });
});

describe('validateParams', () => {
  it('returns empty array when all required params are present', () => {
    const missing = validateParams(
      '{{name}} {{age}}',
      { name: 'Alice', age: 30 },
      new Set(['name', 'age'])
    );
    expect(missing).toHaveLength(0);
  });

  it('returns missing required param names', () => {
    const missing = validateParams(
      '{{name}} {{age}}',
      { name: 'Alice' },
      new Set(['name', 'age'])
    );
    expect(missing).toContain('age');
    expect(missing).not.toContain('name');
  });

  it('returns all missing params when params object is empty', () => {
    const missing = validateParams(
      '{{a}} {{b}} {{c}}',
      {},
      new Set(['a', 'b', 'c'])
    );
    expect(missing).toHaveLength(3);
  });

  it('treats null values as missing', () => {
    const missing = validateParams(
      '{{x}}',
      { x: null },
      new Set(['x'])
    );
    expect(missing).toContain('x');
  });

  it('does not report optional params (not in requiredParams set) as missing', () => {
    const missing = validateParams(
      '{{required}} {{optional}}',
      { required: 'ok' },
      new Set(['required'])
    );
    expect(missing).toHaveLength(0);
  });
});
