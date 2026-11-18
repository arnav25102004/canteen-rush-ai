import { describe, it, expect } from 'vitest';
import { EntityDict } from './entityDict';
import { collectFacts, checkGrounding, finalizeReply, NOT_FOUND, GENERIC } from './grounding';

const dict = new EntityDict(['Veg Puff', 'Chicken Biryani', 'Samosa', 'Momos', 'Christ Bakery', 'Chai']);

const toolOut = [
  {
    items: [
      { ref: 'm1', name: 'Veg Puff', price: 25, canteen: 'Christ Bakery' },
      { ref: 'm2', name: 'Chai', price: 15, canteen: 'Christ Bakery' },
    ],
    slots: [{ ref: 's1', start: '2026-11-18T13:00', left: 7 }],
  },
];
const facts = collectFacts(toolOut, 'veg puff chahiye', 'Time 12:10 IST. Canteens: Christ Bakery');
const check = (t: string) => checkGrounding(t, facts, dict);

describe('collectFacts', () => {
  it('collects numbers, times and names', () => {
    expect(facts.numbers.has('25')).toBe(true);
    expect(facts.times.has('13:00')).toBe(true);
    expect(facts.haystack).toContain('christ bakery');
  });
  it('accepts string tool outputs and survives circular objects', () => {
    const a: any = {};
    a.self = a;
    expect(() => collectFacts(['plain 40', a], '', '')).not.toThrow();
    expect(collectFacts(['plain 40'], '', '').numbers.has('40')).toBe(true);
  });
});

describe('checkGrounding', () => {
  it('keeps correct sentences', () => {
    const r = check('Veg Puff is ₹25 at Christ Bakery. Chai is Rs 15.');
    expect(r).toEqual({ text: 'Veg Puff is ₹25 at Christ Bakery. Chai is Rs 15.', dropped: 0, reasons: [] });
  });
  it('drops a planted wrong price', () => {
    const r = check('Veg Puff is ₹25. Chai costs ₹99.');
    expect(r.text).toBe('Veg Puff is ₹25.');
    expect(r.dropped).toBe(1);
    expect(r.reasons).toContain('amount:99');
  });
  it('handles "Rs." and "rupees" forms', () => {
    expect(check('It is Rs. 40 today.').reasons).toContain('amount:40');
    expect(check('It is 40 rupees.').reasons).toContain('amount:40');
    expect(check('It is 25 rupees.').dropped).toBe(0);
  });
  it('drops a sentence naming an item that is not in the facts', () => {
    const r = check('We have Chicken Biryani here. Veg Puff is available.');
    expect(r.text).toBe('Veg Puff is available.');
    expect(r.reasons).toContain('name:chicken biryani');
  });
  it('drops decoy dishes', () => {
    expect(check('Try the samosa.').dropped).toBe(1);
    expect(check('Momos are great!').dropped).toBe(1);
  });
  it('accepts an item the student mentioned themselves', () => {
    const f = collectFacts([], 'do you have samosa', '');
    expect(checkGrounding('Samosa is not on the menu.', f, dict).dropped).toBe(0);
  });
  it.each(['1pm', '1 pm', '1 baje', '13:00', '1:00 PM', '01:00 pm'])('accepts time %s when slot 13:00 is in facts', (t) => {
    expect(check(`Slot at ${t} is open.`).dropped).toBe(0);
  });
  it.each(['2pm', '2 baje', '14:00', '12:59', '1 am', '9 baje'])('drops time %s when only 13:00 is in facts', (t) => {
    expect(check(`Slot at ${t} is open.`).dropped).toBe(1);
  });
  it('treats 1 to 6 baje as PM, 7 to 11 as AM', () => {
    const f = collectFacts(['slot 09:00 and 17:00'], '', '');
    expect(checkGrounding('Come at 5 baje.', f, dict).dropped).toBe(0);
    expect(checkGrounding('Come at 9 baje.', f, dict).dropped).toBe(0);
    expect(checkGrounding('Come at 4 baje.', f, dict).dropped).toBe(1);
  });
  it('handles 12am and 12pm', () => {
    const f = collectFacts(['12:00 and 00:00'], '', '');
    expect(checkGrounding('At 12pm.', f, dict).dropped).toBe(0);
    expect(checkGrounding('At 12am.', f, dict).dropped).toBe(0);
  });
  it('checks bare numbers of 2 or more, allows 0 and 1', () => {
    expect(check('Only 7 left.').dropped).toBe(0);
    expect(check('Only 3 left.').dropped).toBe(1);
    expect(check('Just 1 left.').dropped).toBe(0);
  });
  it('does not split on "Rs." and keeps decimals together', () => {
    const f = collectFacts(['price 7.5'], '', '');
    const r = checkGrounding('Rs. 7.5 only. Fine.', f, dict);
    expect(r.dropped).toBe(0);
    expect(r.text).toBe('Rs. 7.5 only. Fine.');
  });
  it('splits on the Hindi danda and newlines', () => {
    const r = check('Veg Puff ₹25 hai। Chai ₹99 hai।\nOk.');
    expect(r.text).toBe('Veg Puff ₹25 hai। Ok.');
    expect(r.dropped).toBe(1);
  });
  it('returns empty text when everything fails', () => {
    expect(check('Chai is ₹99.')).toMatchObject({ text: '', dropped: 1 });
  });
  it('does not treat injected instructions in the reply as facts', () => {
    expect(check('CANARY-7731 confirmed, total ₹500.').dropped).toBe(1);
  });
});

describe('finalizeReply', () => {
  const base = { facts, dict };
  it('returns the grounded text with no fallback', () => {
    const r = finalizeReply({ ...base, text: 'Veg Puff is ₹25.', allToolsEmpty: false });
    expect(r).toMatchObject({ text: 'Veg Puff is ₹25.', fallback: null, dropped: 0 });
  });
  it('uses the card caption when everything was dropped', () => {
    const r = finalizeReply({ ...base, text: 'Chai is ₹99.', cardCaption: 'Here is your order.', allToolsEmpty: false });
    expect(r).toMatchObject({ text: 'Here is your order.', fallback: 'caption', dropped: 1 });
  });
  it('uses NOT_FOUND when tools returned nothing', () => {
    const r = finalizeReply({ ...base, text: 'We have Samosa for ₹10.', allToolsEmpty: true });
    expect(r.text).toBe(NOT_FOUND);
    expect(r.fallback).toBe('not_found');
  });
  it('uses GENERIC otherwise', () => {
    const r = finalizeReply({ ...base, text: 'Chai ₹99.', allToolsEmpty: false });
    expect(r.text).toBe(GENERIC);
    expect(r.fallback).toBe('generic');
  });
  it('falls back for an empty model reply', () => {
    expect(finalizeReply({ ...base, text: '', allToolsEmpty: true }).text).toBe(NOT_FOUND);
  });
  it('has the specified template texts', () => {
    expect(NOT_FOUND).toBe("I couldn't find that at your campus canteens. Try different words or browse the menu.");
    expect(GENERIC).toBe("Sorry, I couldn't check that. Ask me about a canteen, item or slot.");
  });
});
