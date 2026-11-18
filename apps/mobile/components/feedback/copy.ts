// All user-facing text for the review flow. English and Hinglish, keyed.
// Components must read from here, never hard-code strings.

export type Lang = 'en' | 'hi';

const en = {
  title: 'Rate your order',
  close: 'Close',
  back: 'Back',
  next: 'Next',
  skipStep: 'Skip',
  langToggle: 'Hinglish',
  loading: 'Checking your order…',
  notEligible: 'You can\'t review this order',
  tryAgain: 'Try again',

  vibeQuestion: 'How was your food?',
  vibeHint: 'Tap a face. That is all it takes.',
  vibe1: 'Awful', vibe2: 'Not good', vibe3: 'Okay', vibe4: 'Good', vibe5: 'Loved it',
  vibeLabel: 'Rate {n} out of 5, {name}',
  quickSubmit: 'Quick submit',
  addMore: 'Add details',

  itemsTitle: 'Rate each item',
  itemsHint: 'Swipe right if you loved it, left if not great, up to skip. Or use the buttons.',
  loved: 'Loved it',
  notGreat: 'Not great',
  skip: 'Skip',
  tapForStars: 'Tap for stars',
  stars: 'Stars',
  starLabel: '{n} of 5 stars',
  taste: 'Taste',
  portion: 'Portion',
  value: 'Value',
  meterLabel: '{name}: {n} of 5',
  itemDone: 'All items done',
  itemProgress: 'Item {i} of {n}',
  undo: 'Undo',

  extrasTitle: 'Anything else?',
  canteenTags: 'About the canteen',
  tagFast: 'Fast', tagClean: 'Clean', tagPolite: 'Polite',
  tagLongQueue: 'Long queue', tagWrongItem: 'Wrong item', tagColdFood: 'Cold food',
  notePlaceholder: 'Add a note (optional)',
  noteCounter: '{n}/500',
  piiHint: 'Please don\'t share phone numbers, emails or UPI IDs.',
  anonymous: 'Send anonymously',
  anonymousExplain: 'Canteen won\'t see your name',
  anonymousAdminNote: 'A Campus Khana super admin can look it up only to handle abuse, and every lookup is logged.',
  submit: 'Submit review',
  update: 'Update review',

  sending: 'Sending…',
  queued: 'Saved, will send when online',
  sentOk: 'Sent',
  failedPrefix: 'Could not send: ',

  thanksTitle: 'Thank you!',
  thanksBody: 'Your feedback helps the canteen get better.',
  thanksNegative: 'We\'ll tell you if something changes.',
  thanksQueued: 'Saved. We\'ll send it as soon as you are online.',
  done: 'Done',
  editReview: 'Edit review',

  editMode: 'Editing your review',
  editWindow: 'You can edit for 24 hours after submitting.',
  alreadyReviewed: 'You already reviewed this order. You can edit it instead.',

  entryTitle: 'How was your order?',
  entryBody: 'Rate it in under 10 seconds.',
  entryCta: 'Rate now',
  chipRate: 'Rate',
  chipRated: 'Rated',
  chipSending: 'Sending…',
  chipQueued: 'Will send',
  chipRateLabel: 'Rate order {n}',
  chipRatedLabel: 'Order {n} already rated',

  errGeneric: 'Something went wrong. Please try again.',
  draftRestored: 'We restored your draft.',
};

export type CopyKey = keyof typeof en;

const hi: Record<CopyKey, string> = {
  ...en,
  title: 'Apna order rate karein',
  close: 'Band karein',
  back: 'Wapas',
  next: 'Aage',
  skipStep: 'Skip',
  langToggle: 'English',
  loading: 'Order check ho raha hai…',
  notEligible: 'Is order ka review nahi ho sakta',
  tryAgain: 'Phir try karein',
  vibeQuestion: 'Khana kaisa laga?',
  vibeHint: 'Ek chehre par tap karein. Bas itna hi.',
  vibe1: 'Bekar', vibe2: 'Theek nahi', vibe3: 'Chalega', vibe4: 'Accha', vibe5: 'Zabardast',
  vibeLabel: '5 mein se {n}, {name}',
  quickSubmit: 'Jaldi bhejein',
  addMore: 'Aur batayein',
  itemsTitle: 'Har item rate karein',
  itemsHint: 'Pasand aaya to right, nahi to left, chhodna ho to upar swipe karein. Ya buttons dabayein.',
  loved: 'Pasand aaya',
  notGreat: 'Itna accha nahi',
  skip: 'Chhodein',
  tapForStars: 'Stars ke liye tap karein',
  stars: 'Stars',
  starLabel: '5 mein se {n} stars',
  taste: 'Swaad',
  portion: 'Quantity',
  value: 'Paisa vasool',
  meterLabel: '{name}: 5 mein se {n}',
  itemDone: 'Sab items ho gaye',
  itemProgress: 'Item {i} / {n}',
  undo: 'Undo',
  extrasTitle: 'Aur kuch?',
  canteenTags: 'Canteen ke baare mein',
  tagFast: 'Fast', tagClean: 'Saaf', tagPolite: 'Tameez se',
  tagLongQueue: 'Lambi line', tagWrongItem: 'Galat item', tagColdFood: 'Thanda khana',
  notePlaceholder: 'Kuch likhna hai? (optional)',
  piiHint: 'Phone number, email ya UPI ID share na karein.',
  anonymous: 'Anonymous bhejein',
  anonymousExplain: 'Canteen ko aapka naam nahi dikhega',
  anonymousAdminNote: 'Sirf misuse rokne ke liye Campus Khana super admin naam dekh sakta hai, aur har lookup log hota hai.',
  submit: 'Review bhejein',
  update: 'Review update karein',
  sending: 'Bhej rahe hain…',
  queued: 'Save ho gaya, online hote hi bhej denge',
  sentOk: 'Bhej diya',
  failedPrefix: 'Nahi bhej paye: ',
  thanksTitle: 'Shukriya!',
  thanksBody: 'Aapke feedback se canteen behtar banega.',
  thanksNegative: 'Kuch badla to hum aapko bata denge.',
  thanksQueued: 'Save ho gaya. Online hote hi bhej denge.',
  done: 'Ho gaya',
  editReview: 'Review badlein',
  editMode: 'Review edit ho raha hai',
  editWindow: 'Bhejne ke 24 ghante tak edit kar sakte hain.',
  alreadyReviewed: 'Is order ka review ho chuka hai. Aap use edit kar sakte hain.',
  entryTitle: 'Order kaisa raha?',
  entryBody: '10 second se kam mein rate karein.',
  entryCta: 'Abhi rate karein',
  chipRate: 'Rate',
  chipRated: 'Rated',
  chipSending: 'Bhej rahe hain…',
  chipQueued: 'Bhejna baaki',
  chipRateLabel: 'Order {n} rate karein',
  chipRatedLabel: 'Order {n} rate ho chuka',
  errGeneric: 'Kuch gadbad hui. Phir try karein.',
  draftRestored: 'Aapka draft wapas aa gaya.',
};

const maps: Record<Lang, Record<CopyKey, string>> = { en, hi };

export function t(key: CopyKey, lang: Lang = 'en', vars?: Record<string, string | number>): string {
  let s = maps[lang][key] ?? en[key];
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
  return s;
}

export const VIBE_FACES = ['😞', '🙁', '😐', '🙂', '😋'] as const;
export const VIBE_KEYS: CopyKey[] = ['vibe1', 'vibe2', 'vibe3', 'vibe4', 'vibe5'];

/** UI label key -> tag the server accepts (see FEEDBACK_TAGS in the server's utils/feedbackSchemas.ts). */
export const CANTEEN_TAG_CHOICES: { tag: string; label: CopyKey }[] = [
  { tag: 'quick', label: 'tagFast' },
  { tag: 'clean', label: 'tagClean' },
  { tag: 'friendly_staff', label: 'tagPolite' },
  { tag: 'long_queue', label: 'tagLongQueue' },
  { tag: 'wrong_item', label: 'tagWrongItem' },
  { tag: 'cold', label: 'tagColdFood' },
];

export const NOTE_MAX = 500;
