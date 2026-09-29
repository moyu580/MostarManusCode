import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';

const source = fs.readFileSync(new URL('../../public/agent-widget.js', import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function mount() {
  let stream;
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://widget.test/', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom;
  window.AbortController = AbortController;
  window.TextDecoder = TextDecoder;
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.fetch = async () => ({
    ok: true,
    body: new ReadableStream({ start(controller) { stream = controller; } }),
  });
  window.eval(source);
  await tick();
  window.document.querySelector('.mmw-bubble').click();
  const input = window.document.querySelector('.mmw-input');
  return {
    dom,
    input,
    send(text) {
      input.value = text;
      window.document.querySelector('.mmw-send').click();
    },
    push(text) { stream.enqueue(new TextEncoder().encode(text)); },
    bot() { return window.document.querySelector('.mmw-row.mmw-bot:last-child .mmw-msg'); },
  };
}

describe('AI widget streaming renderer', () => {
  it('handles CRLF/done, batches DOM updates, and renders common Markdown safely', async () => {
    const widget = await mount();
    widget.send('render');
    const mutations = [];
    const observer = new widget.dom.window.MutationObserver((records) => mutations.push(...records));
    observer.observe(widget.bot(), { childList: true });

    const markdown = '## Example\n\n`**literal**`\n\n```c++\nint main() {}\n```\n\n| Name | Value |\n| --- | --- |\n| A | 1 |\n\n> Quote';
    widget.push(`event: message\r\n${markdown.split('\n').map((line) => `data: ${line}\r\n`).join('')}\r\nevent: done\r\ndata: [DONE]\r\n\r\n`);
    await tick();
    await tick();

    assert.equal(widget.input.disabled, false);
    assert.equal(widget.bot().querySelector('code.mmw-code strong'), null);
    assert.equal(widget.bot().querySelectorAll('pre').length, 1);
    assert.equal(widget.bot().querySelectorAll('table').length, 1);
    assert.equal(widget.bot().querySelectorAll('blockquote').length, 1);
    assert.ok(mutations.length < 10, `expected batched rendering, got ${mutations.length} mutations`);
    observer.disconnect();
    widget.dom.window.close();
  });
});
