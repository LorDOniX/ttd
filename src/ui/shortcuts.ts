import { h } from './dom';

export interface Shortcut {
  // KeyboardEvent.code – fyzická klávesa, takže zkratky sedí i na české klávesnici
  codes: string[];
  key: string;
  label: string;
  run: () => void;
}

const PAN_DIRECTIONS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

// Klávesové zkratky hry a posun mapy držením šipek
export class Shortcuts {
  private readonly held = new Set<string>();

  constructor(private readonly list: Shortcut[]) {
    window.addEventListener('keydown', (e) => {
      // Ctrl/Cmd/Alt nechá prohlížeči (Cmd+R apod.), psaní do polí nechá polím
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.code in PAN_DIRECTIONS) {
        e.preventDefault();
        this.held.add(e.code);
        return;
      }
      const shortcut = this.list.find((s) => s.codes.includes(e.code));
      if (!shortcut) return;
      e.preventDefault();
      if (!e.repeat) shortcut.run();
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
  }

  // Směr posunu podle držených šipek (x doprava, y nahoru)
  panDirection(): [number, number] {
    let x = 0;
    let y = 0;
    for (const code of this.held) {
      const [dx, dy] = PAN_DIRECTIONS[code];
      x += dx;
      y += dy;
    }
    return [x, y];
  }

  help(): HTMLElement {
    const row = (key: string, label: string): HTMLTableRowElement =>
      h('tr', {}, h('td', {}, h('kbd', {}, key)), h('td', {}, label));
    return h(
      'table',
      { className: 'table shortcuts' },
      row('Šipky', 'Posun mapy'),
      ...this.list.map((s) => row(s.key, s.label)),
    );
  }
}
