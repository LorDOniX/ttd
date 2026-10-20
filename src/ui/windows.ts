interface OpenWindow {
  el: HTMLElement;
  body: HTMLElement;
  onClose?: () => void;
  locate?: () => void;
}

export interface WindowOptions {
  width?: number;
  onClose?: () => void;
  // Vycentruje pohled na místo, ke kterému se okno váže
  locate?: () => void;
}

// Okna nad 3D scénou; klávesa Delete zavře všechna
export class WindowManager {
  private readonly windows = new Map<string, OpenWindow>();
  private zIndex = 10;

  constructor(private readonly root: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Delete') return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea')) return;
      this.closeAll();
    });
  }

  isOpen(id: string): boolean {
    return this.windows.has(id);
  }

  // Otevře okno, případně nahradí obsah už otevřeného okna se stejným id
  open(id: string, title: string, content: HTMLElement, options: WindowOptions = {}): void {
    const existing = this.windows.get(id);
    if (existing) {
      // Obnovení obsahu se stejnými options nesmí odhlásit odběr událostí
      if (existing.onClose !== options.onClose) existing.onClose?.();
      existing.onClose = options.onClose;
      existing.locate = options.locate;
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

    el.addEventListener('pointerdown', () => this.bringToFront(el));
    this.makeDraggable(el, header);
    this.bringToFront(el);
    this.windows.set(id, { el, body, onClose: options.onClose, locate: options.locate });
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
