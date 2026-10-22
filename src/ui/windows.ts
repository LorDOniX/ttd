interface OpenWindow {
  el: HTMLElement;
  body: HTMLElement;
  onClose?: () => void;
  locate?: () => void;
  // Obsah čekající, až uživatel pustí tlačítko myši v okně
  pending: HTMLElement | null;
}

export interface WindowOptions {
  width?: number;
  onClose?: () => void;
  // Vycentruje pohled na místo, ke kterému se okno váže
  locate?: () => void;
}

const POSITIONS_KEY = 'ttd-window-positions';

// Okna stejného druhu (např. všechny vlaky) sdílejí polohu: train-3 → train
function positionKey(id: string): string {
  return id.replace(/-\d+$/, '');
}

function loadPositions(): Record<string, { left: number; top: number }> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(POSITIONS_KEY) ?? '{}');
    return typeof saved === 'object' && saved !== null ? (saved as Record<string, { left: number; top: number }>) : {};
  } catch {
    return {};
  }
}

// Okna nad 3D scénou
export class WindowManager {
  private readonly windows = new Map<string, OpenWindow>();
  private zIndex = 10;
  private pressed: OpenWindow | null = null;
  // Poslední poloha podle druhu okna, uložená v prohlížeči
  private readonly positions: Record<string, { left: number; top: number }> = loadPositions();
  // Ikony horní lišty podle id okna
  private readonly anchors = new Map<string, HTMLElement>();
  // Místo na obrazovce, nad které se umístí právě otevírané okno
  private placement: DOMRect | null = null;

  constructor(private readonly root: HTMLElement) {
    window.addEventListener('pointerup', () => {
      const win = this.pressed;
      this.pressed = null;
      // Až po click, jinak by nahrazené tlačítko kliknutí nedostalo
      if (win) setTimeout(() => this.flush(win));
    });
  }

  isOpen(id: string): boolean {
    return this.windows.has(id);
  }

  setAnchor(id: string, anchor: HTMLElement): void {
    this.anchors.set(id, anchor);
  }

  // Obnoví obsah otevřeného okna bez přenesení dopředu; během kliknutí nebo výběru v okně počká
  update(id: string, content: HTMLElement): void {
    const win = this.windows.get(id);
    if (!win) return;
    win.pending = content;
    this.flush(win);
  }

  private flush(win: OpenWindow): void {
    if (!win.pending || this.pressed === win) return;
    const active = document.activeElement;
    const editing =
      (active instanceof HTMLSelectElement || active instanceof HTMLInputElement) && win.el.contains(active);
    if (editing) return;
    win.body.replaceChildren(win.pending);
    win.pending = null;
  }

  // Okna otevřená uvnitř open() se umístí nad daný obdélník, např. kliknutý popisek ve scéně
  openAbove(rect: DOMRect, open: () => void): void {
    this.placement = rect;
    try {
      open();
    } finally {
      this.placement = null;
    }
  }

  // Otevře okno, případně nahradí obsah už otevřeného okna se stejným id
  open(id: string, title: string, content: HTMLElement, options: WindowOptions = {}): void {
    const existing = this.windows.get(id);
    if (existing) {
      // Obnovení obsahu se stejnými options nesmí odhlásit odběr událostí
      if (existing.onClose !== options.onClose) existing.onClose?.();
      existing.onClose = options.onClose;
      existing.locate = options.locate;
      existing.pending = null;
      existing.body.replaceChildren(content);
      if (this.placement) this.placeAbove(existing.el, this.placement);
      this.bringToFront(existing.el);
      return;
    }

    const el = document.createElement('div');
    el.className = 'window';
    if (options.width) el.style.width = `${options.width}px`;

    const header = document.createElement('div');
    header.className = 'window__title';
    const titleEl = document.createElement('span');
    titleEl.textContent = title;
    const close = document.createElement('button');
    close.className = 'window__close';
    close.textContent = '×';
    close.title = 'Zavřít';
    close.addEventListener('click', () => this.close(id));
    header.append(titleEl);
    if (options.locate) {
      const locate = document.createElement('button');
      locate.className = 'window__locate';
      locate.textContent = '⌖';
      locate.title = 'Zobrazit na mapě';
      locate.addEventListener('click', () => this.windows.get(id)?.locate?.());
      header.append(locate);
    }
    header.append(close);

    const body = document.createElement('div');
    body.className = 'window__body';
    body.append(content);

    el.append(header, body);
    this.root.append(el);

    const offset = (this.windows.size % 6) * 24;
    const key = positionKey(id);
    const saved = this.positions[key];
    // Další okno stejného druhu se posune, aby nezakrylo předchozí
    const shift = [...this.windows.keys()].filter((k) => positionKey(k) === key).length * 24;
    // Bez uložené polohy nahoře uprostřed pod lištou
    const left = saved ? saved.left + shift : (window.innerWidth - el.offsetWidth) / 2 + offset;
    const top = saved ? saved.top + shift : 44 + offset;
    el.style.left = `${Math.max(0, Math.min(left, window.innerWidth - 80))}px`;
    el.style.top = `${Math.max(0, Math.min(top, window.innerHeight - 60))}px`;
    // Okna z horní lišty vždy pod svou ikonou
    const anchor = this.anchors.get(id);
    if (anchor) this.placeBelow(el, anchor);
    if (this.placement) this.placeAbove(el, this.placement);

    const win: OpenWindow = { el, body, onClose: options.onClose, locate: options.locate, pending: null };
    el.addEventListener('pointerdown', () => {
      this.pressed = win;
      this.bringToFront(el);
    });
    el.addEventListener('focusout', () => setTimeout(() => this.flush(win)));
    // Vybraný seznam by jinak držel fokus a blokoval obnovy okna
    el.addEventListener('change', (e) => {
      if (e.target instanceof HTMLSelectElement) e.target.blur();
    });
    this.makeDraggable(el, header, () => this.remember(id, el));
    this.bringToFront(el);
    this.windows.set(id, win);
  }

  close(id: string): void {
    const win = this.windows.get(id);
    if (!win) return;
    win.onClose?.();
    win.el.remove();
    this.windows.delete(id);
  }

  closeAll(): void {
    // Mazání z Map během iterace je v JS bezpečné
    for (const id of this.windows.keys()) this.close(id);
  }

  // Zavře okno navrchu; vrací false, když žádné otevřené není
  closeTop(): boolean {
    let top: string | null = null;
    let topZ = -1;
    for (const [id, win] of this.windows) {
      const z = Number(win.el.style.zIndex);
      if (z > topZ) [top, topZ] = [id, z];
    }
    if (top === null) return false;
    this.close(top);
    return true;
  }

  private bringToFront(el: HTMLElement): void {
    el.style.zIndex = String(++this.zIndex);
  }

  private placeBelow(el: HTMLElement, anchor: HTMLElement): void {
    const target = anchor.getBoundingClientRect();
    const left = target.left + target.width / 2 - el.offsetWidth / 2;
    el.style.left = `${Math.max(0, Math.min(left, window.innerWidth - el.offsetWidth))}px`;
    el.style.top = `${(this.root.querySelector('.toolbar')?.getBoundingClientRect().bottom ?? target.bottom) + 4}px`;
  }

  // Nad cílem, a když se tam pod horní lištu nevejde, pod ním
  private placeAbove(el: HTMLElement, target: DOMRect): void {
    const minTop = this.root.querySelector('.toolbar')?.getBoundingClientRect().bottom ?? 0;
    const left = target.left + target.width / 2 - el.offsetWidth / 2;
    const above = target.top - el.offsetHeight - 6;
    const top = above >= minTop ? above : target.bottom + 6;
    el.style.left = `${Math.max(0, Math.min(left, window.innerWidth - el.offsetWidth))}px`;
    el.style.top = `${Math.max(minTop, Math.min(top, window.innerHeight - el.offsetHeight))}px`;
  }

  private remember(id: string, el: HTMLElement): void {
    this.positions[positionKey(id)] = { left: el.offsetLeft, top: el.offsetTop };
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(this.positions));
  }

  private makeDraggable(el: HTMLElement, handle: HTMLElement, onMoved: () => void): void {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
      const startX = e.clientX - el.offsetLeft;
      const startY = e.clientY - el.offsetTop;
      handle.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent): void => {
        el.style.left = `${ev.clientX - startX}px`;
        el.style.top = `${Math.max(0, ev.clientY - startY)}px`;
      };
      const up = (): void => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        onMoved();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }
}
