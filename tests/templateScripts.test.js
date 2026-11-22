// The inline <script> of every template must at least parse: a single
// syntax error (an unescaped apostrophe in « l'import ») stops the whole
// page's script, and the page stays on « Chargement… ». The Django tags are
// replaced by a placeholder first ({% url 'x' %} -> 0).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', 'hakkadbapp', 'templates');

function templates(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return templates(full);
        return entry.name.endsWith('.html') ? [full] : [];
    });
}

for (const file of templates(ROOT)) {
    const html = fs.readFileSync(file, 'utf8');
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)]
        .filter((m) => !/type=["'](?!text\/javascript|module)/.test(m[1]))
        .map((m) => m[2]);
    if (!scripts.length) continue;
    test(`inline scripts parse: ${path.relative(ROOT, file)}`, () => {
        scripts.forEach((code, i) => {
            const plain = code
                // {% if %}a{% else %}b{% endif %} -> a ; the block tags themselves vanish.
                .replace(/\{%\s*(?:else|elif)\b[\s\S]*?\{%\s*endif\s*%\}/g, '')
                .replace(/\{%\s*(?:if|endif|for|empty|endfor|with|endwith|comment|endcomment)\b[\s\S]*?%\}/g, '')
                .replace(/\{%[\s\S]*?%\}/g, '0')
                .replace(/\{\{[\s\S]*?\}\}/g, '0')
                .replace(/\{#[\s\S]*?#\}/g, '');
            assert.doesNotThrow(() => new vm.Script(plain, { filename: `${path.basename(file)}#${i + 1}` }),
                `script ${i + 1} of ${path.basename(file)}`);
        });
    });
}
