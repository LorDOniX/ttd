import type { Kit } from '../assets';
import { modelThumb } from '../render/icons';
import { h } from './dom';

export interface PickerOption {
  value: string;
  kit: Kit;
  model: string;
  name: string;
  details: string;
  // Nadpis skupiny, pod kterou řádek patří (např. druh nákladu)
  group?: string;
}

// Rozbalovací výběr modelu: na řádku vlevo obrázek, vpravo popisky; zavřený ukazuje vybraný řádek.
// Okno ho při obnově obsahu vkládá znovu tentýž, takže otevřený seznam se nezavře
export class ModelPicker {
  readonly element = h('div', { className: 'picker' });
  value = '';
  private readonly current = h('button', { className: 'picker__current', type: 'button' });
  private readonly list = h('div', { className: 'picker__list' });
  private options: PickerOption[] = [];
  private key = '';
  private open = false;

  constructor() {
    this.list.hidden = true;
    this.element.append(this.current, this.list);
    this.current.addEventListener('click', () => this.setOpen(!this.open));
  }

  get selected(): PickerOption | undefined {
    return this.options.find((o) => o.value === this.value);
  }

  // Seznam se přestaví, jen když se nabídka změnila; výběr zůstane, dokud model existuje
  setOptions(options: PickerOption[], fallback: string): void {
    if (!options.some((o) => o.value === this.value)) this.value = fallback;
    const key = options.map((o) => `${o.value}|${o.name}|${o.details}`).join(';');
    if (key !== this.key) {
      this.key = key;
      this.options = options;
      this.renderList();
    }
    this.renderCurrent();
  }

  private readonly closeOutside = (e: PointerEvent): void => {
    if (!this.element.contains(e.target as Node)) this.setOpen(false);
  };

  private setOpen(open: boolean): void {
    this.open = open;
    this.list.hidden = !open;
    this.current.classList.toggle('picker__current--open', open);
    if (!open) {
      document.removeEventListener('pointerdown', this.closeOutside, true);
      return;
    }
    document.addEventListener('pointerdown', this.closeOutside, true);
    this.list.querySelector('.picker__option--active')?.scrollIntoView({ block: 'nearest' });
  }

  private row(option: PickerOption): HTMLElement {
    return h(
      'span',
      { className: 'picker__row' },
      modelThumb(option.kit, option.model, 'picker__image'),
      h('span', { className: 'picker__text' }, h('strong', {}, option.name), h('small', {}, option.details)),
    );
  }

  private renderCurrent(): void {
    const option = this.selected;
    this.current.replaceChildren(...(option ? [this.row(option)] : []), h('span', { className: 'picker__arrow' }, '▾'));
  }

  private renderList(): void {
    const items: HTMLElement[] = [];
    let group: string | undefined;
    for (const option of this.options) {
      if (option.group !== undefined && option.group !== group) {
        group = option.group;
        items.push(h('div', { className: 'picker__group' }, group));
      }
      const b = h('button', { className: 'picker__option', type: 'button' }, this.row(option));
      b.classList.toggle('picker__option--active', option.value === this.value);
      b.addEventListener('click', () => {
        this.value = option.value;
        this.renderList();
        this.renderCurrent();
        this.setOpen(false);
      });
      items.push(b);
    }
    this.list.replaceChildren(...items);
  }
}
