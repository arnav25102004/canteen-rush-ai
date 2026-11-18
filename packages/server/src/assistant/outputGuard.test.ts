import { describe, it, expect } from 'vitest';
import { guardOutput } from './outputGuard';
import { REFUSAL } from './scope';

const g = (t: string, toolsCalled = 1) => guardOutput(t, { toolsCalled });

describe('guardOutput', () => {
  it('passes a plain short reply', () => {
    expect(g('Veg Puff is available at Christ Bakery.')).toEqual({
      text: 'Veg Puff is available at Christ Bakery.',
      outcome: 'ok',
    });
  });
  it('strips <think> blocks, including unclosed ones', () => {
    expect(g('<think>secret plan</think>Here you go.').text).toBe('Here you go.');
    expect(g('Hi. <think>never closed').text).toBe('Hi.');
  });
  it('strips markdown markers', () => {
    expect(g('**Veg Puff** is `fresh`.\n- item\n# Head').text).toBe('Veg Puff is fresh.\nitem\nHead');
  });
  it('strips URLs', () => {
    expect(g('Visit https://evil.example/x now or www.evil.com ok').text).toBe('Visit now or ok');
  });
  it('strips stray ref tokens but keeps normal words', () => {
    expect(g('Try m4 from c12').text).toBe('Try from');
    expect(g('Say mango, sandwich and chai').text).toBe('Say mango, sandwich and chai');
  });
  it('refuses code fences', () => {
    expect(g('Sure:\n```py\nprint(1)\n```')).toEqual({ text: REFUSAL, outcome: 'refused_guard' });
  });
  it('refuses code-like lines', () => {
    expect(g('def add(a, b):\n  return a+b').outcome).toBe('refused_guard');
    expect(g('import os').outcome).toBe('refused_guard');
    expect(g('#include <stdio.h>').outcome).toBe('refused_guard');
    expect(g('SELECT * FROM users').outcome).toBe('refused_guard');
  });
  it('refuses 3 or more lines ending in ; { }', () => {
    expect(g('a = 1;\nb = 2;\nc = 3;').outcome).toBe('refused_guard');
    expect(g('a = 1;\nb = 2;').outcome).toBe('ok');
  });
  it('refuses long replies when no tool was called', () => {
    const long = 'This is a very long answer. '.repeat(20);
    expect(g(long, 0)).toEqual({ text: REFUSAL, outcome: 'refused_guard' });
    expect(g(long, 2).outcome).toBe('clipped');
  });
  it('allows short replies with no tool call', () => {
    expect(g('Hello! What would you like?', 0).outcome).toBe('ok');
  });
  it('clips to 400 characters at a sentence boundary', () => {
    const t = 'Sentence number one is here. '.repeat(20).trim();
    const r = g(t);
    expect(r.outcome).toBe('clipped');
    expect(r.text.length).toBeLessThanOrEqual(400);
    expect(r.text.endsWith('.')).toBe(true);
  });
  it('hard clips with ellipsis when there is no sentence boundary', () => {
    const r = g('word '.repeat(150).trim());
    expect(r.outcome).toBe('clipped');
    expect(r.text.length).toBeLessThanOrEqual(401);
    expect(r.text.endsWith('…')).toBe(true);
  });
  it('catches code hidden inside think tags only after stripping', () => {
    expect(g('<think>```x```</think>Done.').outcome).toBe('ok');
  });
});
