# JS tests

Unit tests for the plain `<script>`-tag JS files in
`hakkadbapp/static/hakkadbapp/js/`. No build step, no framework, no
`npm install` needed -- just Node's own built-in test runner.

## Running the tests

From the `app/` folder (where `package.json` and `manage.py` live):

```bash
npm test
```

That's it. No dependencies to install first.

Under the hood this just runs `node --test tests/`, so you can also run a
single file directly while working on it:

```bash
node --test tests/sentence.test.js
```

Requires Node 20+ (the built-in test runner). Check with `node --version`.

## What's covered

| File | Tests | What it's about |
|---|---|---|
| `sentence.test.js` | `Sentence.js` | Parsing a token (`好`, `好:constraint`, `好(inline pinyin)`), matching it against a dictionary, handling an ambiguous hanzi (several valid readings), rendering the pinyin/hanzi/french lines, the copy-to-clipboard buttons. |
| `dictionary.test.js` | `Dictionary.js` | Reading pronunciations/words out of the (faked) DOM, looking up a syllable or a hanzi character, tracking unknown characters, de-duplicating on import. |
| `characterInput.test.js` | `CharacterInput.js` | The shared `SyllableInputModel` (parse romanized text into syllables + suggestions, replace/select a suggestion) and `SuggestionBar` (renders suggestion buttons, handles clicks). Used by both the Converter and Transcripter pages. |
| `converter.test.js` | `converter.js` | Just `TextModel`, the one bit of real logic converter.js adds on top of `SyllableInputModel`. See the "What's *not* covered" note below. |

## How a test works, in plain terms

These files aren't written as ES modules (no `import`/`export`) -- they're
meant to be dropped in with a `<script src="...">` tag and rely on classes
like `Sentence` becoming global. To test them in Node, each test file:

1. Reads the real source file(s) off disk (`fs.readFileSync`).
2. Runs that source inside a small sandboxed environment (`vm.runInContext`)
   that only has the bits of a browser the code actually touches --
   normally just a fake `document`. This is done by `tests/helpers/load.js`,
   shared by every test file.
3. Grabs the class it needs out of that sandbox and tests it directly, the
   same way you'd call it from another script tag.

Concretely, a test looks like this:

```js
const { createContext, loadScripts } = require("./helpers/load");

const context = createContext();
loadScripts(context, [{ file: "Sentence.js", exports: ["Sentence"] }]);
const { Sentence } = context;

const dico = { words: [{ dataset: { simp: "好", pinyin: "ho3", french: "bien" } }] };
const sentence = new Sentence(dico, "好", "bien");

assert.equal(sentence.renderPinyinLine(), "ho³"); // digits become superscript
```

No real browser, no real DOM, no real dictionary data -- just the exact
class from the real file, given a small hand-built dictionary so the test
result is easy to predict and explain.

### The "fake DOM" helpers

`tests/helpers/load.js` also exports:

- `makeEl(overrides)` -- a plain object with just enough of a DOM element's
  shape (`dataset`, `classList`, `style`, `addEventListener`, `innerHTML`)
  for the code under test to run against. Not a real element -- just the
  handful of properties/methods the specific file being tested actually
  calls.
- `makeDocumentStub({ bySelector, byId })` -- a fake `document` whose
  `querySelectorAll(selector)` / `getElementById(id)` return whatever
  elements you put in the lookup tables, so a class like `Dictionary` (which
  reads its data straight out of `document.querySelectorAll(...)`) can be
  constructed and tested without a browser.

## What's *not* covered, and why

- **`View`/`Controller` in `converter.js`** aren't unit-tested. They're
  mostly DOM wiring -- grabbing ~15 elements by id and wiring up event
  listeners -- rather than logic. Testing that meaningfully would mean
  faking a large chunk of a whole page's DOM, which stops being a "basic,
  easy to understand" unit test. If this ever needs covering, the next step
  up is an integration/E2E layer (e.g. `jsdom` for a fake-but-fuller DOM, or
  Playwright driving the real dev server) rather than more of this style of
  test.
- **`transcripter.js`, `Word.js`'s edge cases, `Pronunciation.char()`**
  (reads `document.getElementById('toggle-hanzi')` directly) and a handful
  of other small helpers aren't covered yet either -- this is a starting
  point (Sentence, Dictionary, Converter, CharacterInput, as asked for),
  not full coverage. The same `tests/helpers/load.js` harness works for any
  other file in `hakkadbapp/static/hakkadbapp/js/` -- add a new
  `tests/<name>.test.js` following the existing files as a template.

## A gotcha you'll hit if you add more tests: cross-realm objects

Anything returned by code running *inside* the sandboxed context (an object
literal, an array from `.match()`, etc.) is technically a different `Object`
class than the one in this test file -- `vm` gives each context (i.e. each
call to `createContext()`) its own realm. This means
`assert.deepEqual(vmValue, plainValue)` can fail even when every field
matches, because it also compares the two values' prototypes.

The fix used throughout these tests: copy the value into a plain object/array
first, which rebuilds it using *this file's* `Object`/`Array`:

```js
assert.deepEqual({ ...vmObject }, { hanzi: "好" });   // objects
assert.deepEqual([...vmArray], ["ni3", "hao3"]);       // arrays
```

Or simpler still: assert on individual fields (`assert.equal(x.hanzi, "好")`)
instead of the whole object at once -- often clearer to read anyway.
