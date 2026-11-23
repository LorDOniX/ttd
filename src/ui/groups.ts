import { formatMoney, type Game } from '../game/game';
import { groupStats, MAX_GROUP_NAME, type GroupKind, type Groupable } from '../game/groups';
import { h } from './dom';

// Výběr v seznamu vozidel: všechna, bez skupiny, nebo id skupiny
export type GroupFilter = 'all' | 'none' | number;

// Hráč právě píše jméno skupiny nebo vybírá skupinu: seznam se mezitím neobnovuje (jinak by výběr zavřel)
export function editingGroups(): boolean {
  const el = document.activeElement;
  return (
    el instanceof HTMLElement &&
    (el.tagName === 'INPUT' || el.tagName === 'SELECT') &&
    el.closest('.vehicle-groups, .vehicle-groups__select') !== null
  );
}

export function inGroup(vehicle: Groupable, filter: GroupFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'none') return vehicle.group === undefined;
  return vehicle.group === filter;
}

// Platný výběr: zrušená skupina se vrátí na všechna vozidla
export function validFilter(game: Game, kind: GroupKind, filter: GroupFilter): GroupFilter {
  return typeof filter === 'number' && game.groups.byId(filter)?.kind !== kind ? 'all' : filter;
}

// Skupiny nad seznamem vozidel jako v OpenTTD: výběr skupiny, nová skupina, přejmenování, zrušení a zisk skupiny
export function groupPanel(
  game: Game,
  kind: GroupKind,
  filter: GroupFilter,
  select: (filter: GroupFilter) => void,
): HTMLElement {
  const all = game.vehiclesOf(kind);
  const groups = game.groups.of(kind);
  const button = (label: string, value: GroupFilter, title?: string): HTMLButtonElement => {
    const b = h('button', { className: 'small-button', textContent: label, title: title ?? '' });
    b.classList.toggle('small-button--active', filter === value);
    b.addEventListener('click', () => select(value));
    return b;
  };
  const add = h('button', { className: 'small-button', textContent: '+ Nová skupina' });
  add.addEventListener('click', () => select(game.groups.create(kind).id));
  const rows: HTMLElement[] = [
    h(
      'div',
      { className: 'train__actions vehicle-groups__list' },
      'Skupina:',
      button(`Vše (${all.length})`, 'all'),
      ...(groups.length > 0
        ? [button(`Bez skupiny (${all.filter((v) => v.group === undefined).length})`, 'none')]
        : []),
      ...groups.map((g) => button(`${g.name} (${all.filter((v) => v.group === g.id).length})`, g.id)),
      add,
    ),
  ];
  const group = typeof filter === 'number' ? game.groups.byId(filter) : undefined;
  if (group) {
    const stats = groupStats(game.groups.members(group));
    const name = h('input', { type: 'text', value: group.name, maxLength: MAX_GROUP_NAME, title: 'Jméno skupiny' });
    name.addEventListener('change', () => {
      const error = game.groups.rename(group, name.value);
      if (error) game.news(error);
    });
    const remove = h('button', { className: 'small-button', textContent: 'Zrušit skupinu' });
    remove.title = 'Vozidla zůstanou, jen nebudou v žádné skupině';
    remove.addEventListener('click', () => {
      game.groups.remove(group);
      select('all');
    });
    rows.push(
      h(
        'div',
        { className: 'train__actions vehicle-groups__detail' },
        name,
        h(
          'span',
          {},
          `${stats.count} vozidel · zisk letos ${formatMoney(stats.profit)} · loni ${formatMoney(stats.lastProfit)}`,
        ),
        remove,
      ),
    );
  }
  return h('div', { className: 'form vehicle-groups' }, ...rows);
}

// Výběr skupiny v řádku seznamu (klik neotevře okno vozidla)
export function groupSelect(game: Game, kind: GroupKind, vehicle: Groupable): HTMLElement {
  const select = h('select', { className: 'vehicle-groups__select', title: 'Skupina vozidla' });
  select.append(h('option', { value: '', selected: vehicle.group === undefined }, '—'));
  for (const g of game.groups.of(kind)) {
    select.append(h('option', { value: String(g.id), selected: vehicle.group === g.id }, g.name));
  }
  select.addEventListener('click', (e) => e.stopPropagation());
  select.addEventListener('change', () => {
    select.blur();
    const error = game.groups.assign(vehicle, kind, select.value === '' ? null : Number(select.value));
    if (error) game.news(error);
  });
  return select;
}
