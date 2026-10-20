const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 420;
const HEIGHT = 150;
const AXIS_WIDTH = 56;
const LABEL_HEIGHT = 16;
const TOP = 6;

export interface BarSeries {
  label: string;
  color: string;
  values: number[];
}

const compact = new Intl.NumberFormat('cs-CZ', { notation: 'compact', maximumFractionDigits: 1 });

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  text?: string,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  if (text !== undefined) el.textContent = text;
  return el;
}

// Horní mez osy zaokrouhlená na 1, 2 nebo 5 × 10^n
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((s) => s * magnitude >= value)!;
  return step * magnitude;
}

// Sloupcový graf po letech; více řad se kreslí vedle sebe, záporné hodnoty jako nula
export function barChart(labels: string[], series: BarSeries[], format: (value: number) => string): HTMLElement {
  const plotHeight = HEIGHT - TOP - LABEL_HEIGHT;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const y = (value: number): number => TOP + plotHeight * (1 - Math.max(0, value) / max);
  const root = svg('svg', { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, class: 'chart' });

  for (const fraction of [0, 0.5, 1]) {
    const value = max * fraction;
    root.append(
      svg('line', { x1: AXIS_WIDTH, x2: WIDTH, y1: y(value), y2: y(value), class: 'chart__grid' }),
      svg('text', { x: AXIS_WIDTH - 4, y: y(value) + 4, 'text-anchor': 'end' }, compact.format(value)),
    );
  }

  const slot = (WIDTH - AXIS_WIDTH) / Math.max(1, labels.length);
  const barWidth = Math.min(16, (slot * 0.8) / series.length);
  labels.forEach((label, i) => {
    const center = AXIS_WIDTH + slot * (i + 0.5);
    root.append(svg('text', { x: center, y: HEIGHT - 3, 'text-anchor': 'middle' }, label));
    series.forEach((s, j) => {
      const value = s.values[i] ?? 0;
      const top = y(value);
      const bar = svg('rect', {
        x: center + (j - series.length / 2) * barWidth,
        y: top,
        width: barWidth - 1,
        height: TOP + plotHeight - top,
        fill: s.color,
      });
      bar.append(svg('title', {}, `${label} – ${s.label}: ${format(value)}`));
      root.append(bar);
    });
  });

  const legend = document.createElement('div');
  legend.className = 'chart__legend';
  for (const s of series) {
    const item = document.createElement('span');
    const swatch = document.createElement('i');
    swatch.style.background = s.color;
    item.append(swatch, s.label);
    legend.append(item);
  }
  const wrapper = document.createElement('div');
  wrapper.append(root);
  if (series.length > 1) wrapper.append(legend);
  return wrapper;
}
