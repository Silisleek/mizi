import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
const h = React.createElement;

const C = {
  green: '#32CD32',
  cyan: '#56B6C2',
  dim: '#555',
  text: '#DDD',
  border: '#333',
  orange: '#E5A35E',
  lav: '#B57EDC',
};

export function ArrowSelect({ items, onSelect, onCancel, formatItem }) {
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    else if (key.downArrow) setCursor(c => Math.min(items.length - 1, c + 1));
    else if (key.return) onSelect(items[cursor], cursor);
    else if (key.escape) onCancel?.();
  });

  return h(Box, { flexDirection: 'column', paddingLeft: 1 },
    ...items.map((item, i) => {
      const active = i === cursor;
      const label = formatItem ? formatItem(item, i) : String(item);
      return h(Text, { key: i },
        active ? h(Text, { color: C.green }, '▸ ') : h(Text, null, '  '),
        h(Text, { color: active ? C.text : C.dim, bold: active }, label),
      );
    }),
  );
}

export function Spinner({ label = 'Thinking' }) {
  const [frame, setFrame] = useState(0);
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  React.useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % frames.length), 80);
    return () => clearInterval(id);
  }, []);

  return h(Text, { color: C.orange }, `${frames[frame]} ${label}...`);
}

export function StreamingDots() {
  const [frame, setFrame] = useState(0);
  const dots = ['', '.', '..', '...'];

  React.useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % dots.length), 400);
    return () => clearInterval(id);
  }, []);

  return h(Text, { color: C.cyan }, `  streaming${dots[frame]}`);
}

export function TypewriterText({ text, speed = 20 }) {
  const [visible, setVisible] = useState(0);

  React.useEffect(() => {
    if (visible < text.length) {
      const id = setTimeout(() => setVisible(v => v + 1), speed);
      return () => clearTimeout(id);
    }
  }, [visible, text.length, speed]);

  return h(Text, { wrap: 'wrap' }, text.slice(0, visible));
}
