/**
 * A key name alone is not enough to reproduce a real key press.
 *
 * CDP `Input.dispatchKeyEvent` produces trusted events, but Chrome only performs the default action
 * for a key (Tab moving focus, Enter submitting a form, Space activating a button, arrows scrolling)
 * when it receives the Windows virtual key code. Synthetic `KeyboardEvent`s dispatch inside a page
 * additionally need `code` so listeners that key off it keep working.
 */
export interface KeyDescriptor {
  key: string;
  code: string;
  virtualKeyCode: number;
  /** Text the key inserts, absent for keys that only carry intent such as Tab or the arrows. */
  text?: string;
}

const NAMED_KEYS: Readonly<Record<string, Omit<KeyDescriptor, 'key'>>> = {
  Enter: { code: 'Enter', virtualKeyCode: 13, text: '\r' },
  Tab: { code: 'Tab', virtualKeyCode: 9 },
  Escape: { code: 'Escape', virtualKeyCode: 27 },
  Esc: { code: 'Escape', virtualKeyCode: 27 },
  Backspace: { code: 'Backspace', virtualKeyCode: 8 },
  Delete: { code: 'Delete', virtualKeyCode: 46 },
  Insert: { code: 'Insert', virtualKeyCode: 45 },
  Home: { code: 'Home', virtualKeyCode: 36 },
  End: { code: 'End', virtualKeyCode: 35 },
  PageUp: { code: 'PageUp', virtualKeyCode: 33 },
  PageDown: { code: 'PageDown', virtualKeyCode: 34 },
  ArrowLeft: { code: 'ArrowLeft', virtualKeyCode: 37 },
  ArrowUp: { code: 'ArrowUp', virtualKeyCode: 38 },
  ArrowRight: { code: 'ArrowRight', virtualKeyCode: 39 },
  ArrowDown: { code: 'ArrowDown', virtualKeyCode: 40 },
  Space: { code: 'Space', virtualKeyCode: 32, text: ' ' },
  ' ': { code: 'Space', virtualKeyCode: 32, text: ' ' },
};

for (let index = 1; index <= 12; index += 1) {
  (NAMED_KEYS as Record<string, unknown>)[`F${index}`] = {
    code: `F${index}`,
    virtualKeyCode: 111 + index,
  };
}

export function describeKey(key: string): KeyDescriptor {
  const named = NAMED_KEYS[key];
  if (named !== undefined) return { key, ...named };

  if (key.length === 1) {
    const upper = key.toUpperCase();
    const charCode = upper.charCodeAt(0);
    if (upper >= 'A' && upper <= 'Z') {
      return { key, code: `Key${upper}`, virtualKeyCode: charCode, text: key };
    }
    if (key >= '0' && key <= '9') {
      return { key, code: `Digit${key}`, virtualKeyCode: charCode, text: key };
    }
    return { key, code: '', virtualKeyCode: charCode, text: key };
  }

  // Unknown multi-character name: forward it untouched rather than inventing a code.
  return { key, code: '', virtualKeyCode: 0 };
}
