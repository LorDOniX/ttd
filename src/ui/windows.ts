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

// Okna nad 3D scénou
export class WindowManager {
  private readonly windows = new Map<string, OpenWindow>();
  private zIndex = 10;
  private pressed: OpenWindow | null = null;

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

  // Obnoví obsah otevřeného okna bez přenesení dopředu; během kliknutí do okna počká
  update(id: string, content: HTMLElement): void {
    const win = this.windows.get(id);
    if (!win) return;
    win.pending = content;
    if (this.pressed !== win) this.flush(win);
  }

  private flush(win: OpenWindow): void {
    if (!win.pending) return;
    win.body.replaceChildren(win.pending);
    win.pending = null;
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
    el.style.left = `${Math.max(8, (window.innerWidth - el.offsetWidth) / 2 + offset)}px`;
    el.style.top = `${80 + offset}px`;

    const win: OpenWindow = { el, body, onClose: options.onClose, locate: options.locate, pending: null };
    el.addEventListener('pointerdown', () => {
      this.pressed = win;
      this.bringToFront(el);
    });
    this.makeDraggable(el, header);
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

  private makeDraggable(el: HTMLElement, handle: HTMLElement): void {
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
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }
}
